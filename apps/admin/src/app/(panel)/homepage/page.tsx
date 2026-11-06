import type { ResolvedHomepageSection } from '@ajooba/contracts';
import { PageHeader } from '@/components/layout/page-header';
import { HomepageEditor } from '@/features/homepage/components/homepage-editor';
import { OpsApiError, readAdminToken } from '@/lib/ops';
import { apiUrl } from '@/lib/env';

/**
 * Homepage merchandising.
 *
 * The editor starts from the **real saved configuration**, including the resolved
 * product cards, prices and images the API computed â€” not from an empty form. It
 * is threaded the API's own concurrency `version`, which is echoed back on save
 * and rejected on a mismatch. Passing anything else (a timestamp, a zero) makes
 * every save fail with CONFLICT and the editor unusable, which is a mistake this
 * module has already made once.
 */

export const dynamic = 'force-dynamic';

interface AdminHomepage {
  readonly sections: ResolvedHomepageSection[];
  readonly version: number;
}

async function loadSections(): Promise<AdminHomepage> {
  const token = await readAdminToken();
  if (!token) return { sections: [], version: 0 };

  try {
    const response = await fetch(apiUrl('/v1/admin/content/homepage/sections'), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return { sections: [], version: 0 };

    const body = (await response.json()) as {
      ok: boolean;
      data?: { items: Array<{ id: string; section: ResolvedHomepageSection }>; version?: number };
    };
    if (!body.ok) return { sections: [], version: 0 };

    return {
      sections: (body.data?.items ?? []).map((item) => item.section),
      version: body.data?.version ?? 0,
    };
  } catch (error) {
    // An unreachable API is reported, not swallowed: the editor would otherwise
    // open empty and a save would overwrite the live homepage with nothing.
    if (error instanceof OpsApiError) throw error;
    throw new OpsApiError('The homepage configuration could not be read.', 0);
  }
}

export default async function AdminHomepagePage() {
  let loaded: AdminHomepage = { sections: [], version: 0 };
  let failure: string | null = null;

  try {
    loaded = await loadSections();
  } catch (error) {
    failure =
      error instanceof OpsApiError
        ? error.message
        : 'The homepage configuration could not be read.';
  }

  return (
    <>
      <PageHeader
        eyebrow="Storefront Â· Homepage"
        title="Homepage merchandising"
        description="What the storefront's front page shows, in order. Every section reads live catalogue data â€” a hero that names a product which has since been retired renders an honest gap, never a placeholder."
      />

      <div className="page-body">
        {failure ? (
          <div className="sheet p-6" role="alert">
            <p className="step-md font-medium text-ink-900">The homepage could not be read</p>
            <p className="step-sm mt-1.5 max-w-2xl text-ink-600">{failure}</p>
            <p className="step-sm mt-3 max-w-2xl text-ink-500">
              The editor is not shown, because opening it empty and saving would replace the live
              homepage with nothing. Reload once the API is answering.
            </p>
          </div>
        ) : (
          <>
            {loaded.sections.length === 0 ? (
              <div className="mb-6 border border-dashed border-border-strong bg-white p-5">
                <p className="step-sm font-medium text-ink-900">No sections configured yet</p>
                <p className="step-sm mt-1.5 max-w-2xl text-ink-600">
                  The homepage currently uses the storefront&apos;s built-in fallback layout. Add a
                  section below to take control of it. Products are chosen from the real catalogue.
                </p>
              </div>
            ) : null}

            <HomepageEditor initialSections={loaded.sections} initialVersion={loaded.version} />
          </>
        )}
      </div>
    </>
  );
}
