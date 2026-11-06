'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Input, Field } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { accountStore } from '@/lib/account-store';
import { optionalPhone } from '@/lib/format';
import { CustomerAuthError, requestPasswordReset, signIn, signUp } from '@/lib/customer-session';
import { SocialSignIn } from './social-sign-in';

interface AuthFormProps {
  mode: 'login' | 'register' | 'forgot';
}

/**
 * The customer auth form.
 *
 * ## Two backends, one form, and the order matters
 *
 * The real API is tried first. When it answers — success or a genuine refusal —
 * its answer is the answer: a wrong password says so, and an address already
 * registered says so. That is what makes a customer's visit *attributable*,
 * which is the entire reason the interaction ledger can say `cxs@gmail.com
 * opened these designs` rather than "someone did".
 *
 * Only when the API cannot be reached does this fall back to the device-local
 * account that predates it. That fallback is honest about itself on the page and
 * in the toast, and it is deliberately narrow: a refused password must never
 * silently succeed as a local login, because then a shopper would believe they
 * were signed in to an account the shop cannot see.
 */
export function AuthForm({ mode }: AuthFormProps) {
  const { toast } = useToast();
  const params = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  /*
   * Where to go once this succeeds.
   *
   * A refusal on the product page — "sign in to save designs" — links here with
   * `?next=/products/x`, so a shopper who was interrupted lands back on the
   * design they were looking at rather than on an account dashboard they did not
   * ask for. The value is checked as a relative path because it is handed
   * straight to a navigation.
   */
  const rawNext = params.get('next') ?? '';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/account';

  /*
   * The API's OAuth callback reports failures as a short, stable code rather
   * than as prose, because the prose belongs to this page. Each code gets the
   * one sentence that tells the shopper what actually happened.
   */
  useEffect(() => {
    const code = params.get('error');
    if (!code) return;

    const messages: Record<string, string> = {
      oauth_cancelled:
        'Sign-in was cancelled. Nothing changed — you can try again or use your email.',
      oauth_expired: 'That sign-in took too long, so it expired. Please try again.',
      oauth_incomplete:
        'The provider did not send us enough to finish signing in. Please try again.',
      oauth_failed:
        'We could not complete that sign-in. Try again, or use your email and password — they always work.',
    };

    toast({
      title: code === 'oauth_cancelled' ? 'Sign-in cancelled' : 'That sign-in did not finish',
      description:
        messages[code] ?? 'We could not complete that sign-in. Try again, or use your email.',
      tone: 'warning',
    });
  }, [params, toast]);

  const validate = () => {
    const out: Record<string, string> = {};
    if (mode === 'register' && name.trim().length < 2) {
      out.name = 'Please tell us your name.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      out.email = 'Enter a valid email address.';
    }
    /*
     * The password rules here are the API's rules, restated — not a looser
     * approximation of them.
     *
     * These used to say "at least 8 characters" while `passwordSchema` required
     * ten *and* a digit. A shopper who typed `mypassword` passed this check, was
     * sent to the API, and came back with a 422 about a rule the form had just
     * told them they satisfied. Checking the real policy locally is the whole
     * point of a local check: it turns a round-trip refusal into a hint beside
     * the field.
     */
    if (mode === 'register') {
      if (password.length < 10) {
        out.password = 'Use at least 10 characters.';
      } else if (!/[A-Za-z]/.test(password)) {
        out.password = 'Include at least one letter.';
      } else if (!/[0-9]/.test(password)) {
        out.password = 'Include at least one number.';
      }
    } else if (mode === 'login' && password.length === 0) {
      out.password = 'Enter your password.';
    }
    setErrors(out);
    return Object.keys(out).length === 0;
  };

  /** Mirror the server's identity into the local store the header reads. */
  function rememberLocally(fullName: string, address: string, mobile?: string) {
    accountStore.write({
      fullName,
      email: address,
      ...(mobile ? { phone: mobile } : {}),
      joinedAt: new Date().toISOString(),
    });
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !validate()) return;

    setBusy(true);
    try {
      if (mode === 'forgot') {
        await requestPasswordReset(email.trim());
        toast({
          title: 'Check your inbox',
          description:
            'If that address has an account, a reset link is on its way. It expires in one hour.',
          tone: 'success',
        });
        return;
      }

      if (mode === 'register') {
        /*
         * The phone is sent only when one was typed.
         *
         * An empty string is not "no phone" to a schema that validates a phone
         * shape — it is a malformed phone. Sending `undefined` is what makes the
         * field genuinely optional, and checkout asks for a real number later.
         */
        const digits = phone.trim();
        const user = await signUp({
          email: email.trim(),
          ...(digits.length === 10 ? { phone: `+91${digits}` } : {}),
          firstName: name.trim().split(/\s+/)[0] ?? name.trim(),
          lastName: name.trim().split(/\s+/).slice(1).join(' '),
          password,
        });
        rememberLocally(
          `${user.firstName} ${user.lastName}`.trim(),
          user.email,
          optionalPhone(user.phone),
        );
        toast({
          title: 'Account created',
          description: 'You are signed in. Your orders and preferences now follow you.',
          tone: 'success',
        });
      } else {
        const user = await signIn(email.trim(), password);
        rememberLocally(
          `${user.firstName} ${user.lastName}`.trim(),
          user.email,
          optionalPhone(user.phone),
        );
        toast({
          title: 'Signed in',
          description: 'Welcome back.',
          tone: 'success',
        });
      }

      window.setTimeout(() => {
        window.location.href = next;
      }, 400);
    } catch (error) {
      if (
        error instanceof CustomerAuthError &&
        (error.code === 'UNREACHABLE' || error.code === 'NO_API')
      ) {
        /*
         * The API is not answering. Rather than leave the shopper with an error
         * they can do nothing about, fall back to the device-local account — and
         * say plainly that this is what happened, so nobody believes the shop
         * has an account it does not have.
         */
        rememberLocally(
          mode === 'register' ? name.trim() : (email.split('@')[0] ?? 'Guest'),
          email.trim(),
          phone.trim() || undefined,
        );
        toast({
          title: 'Saved on this device only',
          description:
            'The shop could not be reached, so this sign-in is local to this browser. Browsing here will not be attributed to your account until you sign in again.',
          tone: 'warning',
        });
        window.setTimeout(() => {
          window.location.href = '/account';
        }, 600);
        return;
      }

      const message =
        error instanceof CustomerAuthError ? error.message : 'That did not work. Please try again.';

      // Field-level where the API names a field, a form-level message otherwise.
      if (/password/i.test(message)) setErrors({ password: message });
      else if (/email/i.test(message)) setErrors({ email: message });
      else setErrors({ form: message });

      toast({ title: 'Could not continue', description: message, tone: 'warning' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === 'register' ? (
        <Field label="Full name" htmlFor="auth-name" error={errors.name}>
          <Input
            id="auth-name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={Boolean(errors.name)}
          />
        </Field>
      ) : null}
      <Field label="Email address" htmlFor="auth-email" error={errors.email}>
        <Input
          id="auth-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={Boolean(errors.email)}
        />
      </Field>
      {mode === 'register' ? (
        <Field
          label="Mobile number (optional)"
          htmlFor="auth-phone"
          hint="Used for delivery updates when you place an order"
        >
          <Input
            id="auth-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            maxLength={10}
            onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))}
          />
        </Field>
      ) : null}
      {mode !== 'forgot' ? (
        <Field
          label={mode === 'register' ? 'Create a password' : 'Password'}
          htmlFor="auth-password"
          error={errors.password}
          /*
           * The rule is stated beside the field before it is broken, not after a
           * refusal. A limit a shopper only discovers on submit is a trap.
           */
          hint={
            mode === 'register'
              ? 'At least 10 characters, with one letter and one number'
              : undefined
          }
        >
          <Input
            id="auth-password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(errors.password)}
          />
        </Field>
      ) : null}

      {errors.form ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
        >
          {errors.form}
        </p>
      ) : null}

      <Button intent="gold" size="lg" type="submit" block disabled={busy}>
        {busy
          ? mode === 'register'
            ? 'Creating…'
            : mode === 'forgot'
              ? 'Sending…'
              : 'Signing in…'
          : mode === 'register'
            ? 'Create account'
            : mode === 'forgot'
              ? 'Send reset link'
              : 'Sign in'}
      </Button>

      <p className="text-center text-xs text-ink-500">
        {mode === 'login' ? (
          <>
            New to Ajooba?{' '}
            <Link href="/register" className="font-medium text-ink-900 underline">
              Create an account
            </Link>
          </>
        ) : mode === 'register' ? (
          <>
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-ink-900 underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            Remembered it?{' '}
            <Link href="/login" className="font-medium text-ink-900 underline">
              Back to sign in
            </Link>
          </>
        )}
      </p>

      {/*
        Social sign-in sits *below* the email form, not above it.

        The email form is the one that always works, and it is the one that keeps
        an existing customer's order history attached without a round trip to a
        provider. Putting a provider button first would make the reliable path
        look like the fallback.
      */}
      {mode !== 'forgot' ? <SocialSignIn next={next} /> : null}
    </form>
  );
}
