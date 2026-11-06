import type { Order, OrderAddress, OrderItem, ReturnRequest } from '@ajooba/contracts';

/**
 * Transactional email templates.
 *
 * Everything is rendered here as a string — no template engine, no HTML
 * files to deploy alongside the compiled API, and nothing loaded from disk at
 * runtime.
 *
 * Two rules apply to every template:
 *
 *  1. **Only real data is interpolated.** Every value comes from a persisted
 *     order or return. There is no placeholder, no sample order and no
 *     "₹1,999" fallback, because a confirmation email that shows an invented
 *     price is worse than no email at all.
 *  2. **Everything interpolated is escaped.** Customer names, addresses and
 *     return notes are attacker-controllable. `escapeHtml` is applied at the
 *     boundary rather than trusted to the caller.
 */

/**
 * Escape a value for interpolation into HTML.
 *
 * `&` first, then the rest: escaping in the wrong order would double-encode
 * the ampersands introduced by the earlier replacements.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format rupees for an email.
 *
 * `Intl.NumberFormat` with a fixed `en-IN` locale so the grouping is Indian
 * (1,99,999) rather than the runtime's default, which would render the same
 * number differently in different deployments.
 */
export function formatRupees(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Render an address as lines.
 *
 * Only non-empty components are emitted, so a missing `line2` does not leave
 * a dangling comma in the customer's inbox.
 */
export function formatAddress(address: OrderAddress): string[] {
  const lines = [
    address.line1,
    address.line2,
    `${address.city}, ${address.state} ${address.postalCode}`,
    address.country,
  ];
  return lines.map((line) => line.trim()).filter((line) => line.length > 0);
}

/** A rendered email: both parts, ready to hand to the provider. */
export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** The Resend `tag` value for this template. */
  readonly tag: string;
}

/* -------------------------------------------------------------------------- */
/* Shared chrome                                                              */
/* -------------------------------------------------------------------------- */

const BRAND = 'Ajooba Footwear';

/**
 * The one place the layout is defined.
 *
 * Inline styles only, because email clients strip `<style>` blocks and
 * external stylesheets — a template that relies on a stylesheet renders
 * unstyled in Outlook and Gmail.
 */
function layout(input: { heading: string; bodyHtml: string; footerNote: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f6f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f4;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:#1c1c1a;padding:20px 24px;">
              <span style="color:#ffffff;font-size:18px;font-weight:600;letter-spacing:0.5px;">${escapeHtml(BRAND)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px 24px;color:#1c1c1a;font-size:20px;font-weight:600;line-height:1.3;">
              ${escapeHtml(input.heading)}
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px 24px;color:#3d3d38;font-size:15px;line-height:1.6;">
              ${input.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="background:#f6f6f4;padding:18px 24px;color:#7a7a72;font-size:12px;line-height:1.5;">
              ${escapeHtml(input.footerNote)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Render one purchased line as a table row. */
function itemRow(item: OrderItem): string {
  return `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #ecece8;color:#1c1c1a;font-size:14px;">
        ${escapeHtml(item.title)}
        <br><span style="color:#7a7a72;font-size:13px;">${escapeHtml(item.colour)} &middot; Size ${escapeHtml(String(item.size))} &middot; ${escapeHtml(item.sku)}</span>
      </td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #ecece8;color:#7a7a72;font-size:13px;white-space:nowrap;">&times;${escapeHtml(String(item.quantity))}</td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #ecece8;color:#1c1c1a;font-size:14px;white-space:nowrap;">${escapeHtml(formatRupees(item.lineTotal))}</td>
    </tr>`;
}

/** Render the money summary table shared by order emails. */
function totalsTable(order: Order): string {
  const rows: string[] = [
    `<tr><td style="padding:6px 0;color:#3d3d38;font-size:14px;">Subtotal</td><td align="right" style="padding:6px 0;color:#3d3d38;font-size:14px;">${escapeHtml(formatRupees(order.subtotal))}</td></tr>`,
  ];

  if (order.discountAmount > 0) {
    const label = order.couponCode ? `Discount (${order.couponCode})` : 'Discount';
    rows.push(
      `<tr><td style="padding:6px 0;color:#3d3d38;font-size:14px;">${escapeHtml(label)}</td><td align="right" style="padding:6px 0;color:#2f7a3f;font-size:14px;">&minus;${escapeHtml(formatRupees(order.discountAmount))}</td></tr>`,
    );
  }

  if (order.taxAmount > 0) {
    rows.push(
      `<tr><td style="padding:6px 0;color:#3d3d38;font-size:14px;">Tax</td><td align="right" style="padding:6px 0;color:#3d3d38;font-size:14px;">${escapeHtml(formatRupees(order.taxAmount))}</td></tr>`,
    );
  }

  rows.push(
    `<tr><td style="padding:6px 0;color:#3d3d38;font-size:14px;">Shipping</td><td align="right" style="padding:6px 0;color:#3d3d38;font-size:14px;">${escapeHtml(formatRupees(order.shippingFee))}</td></tr>`,
  );
  rows.push(
    `<tr><td style="padding:10px 0 0 0;border-top:2px solid #1c1c1a;color:#1c1c1a;font-size:16px;font-weight:600;">Total</td><td align="right" style="padding:10px 0 0 0;border-top:2px solid #1c1c1a;color:#1c1c1a;font-size:16px;font-weight:600;">${escapeHtml(formatRupees(order.totalAmount))}</td></tr>`,
  );

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">${rows.join('')}</table>`;
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

/** The notification templates this platform sends. */
export const EMAIL_TEMPLATES = [
  'order-confirmation',
  'order-shipped',
  'order-delivered',
  'order-cancelled',
  'return-acknowledged',
  'return-approved',
  'return-refunded',
  'return-rejected',
  'password-reset',
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

/**
 * Order placed and paid.
 *
 * Sent **once** — when the payment is confirmed, not when the order row is
 * created. An order that is never paid gets no confirmation, so a customer
 * cannot believe an unpaid order is on its way.
 */
export function renderOrderConfirmation(order: Order, orderUrl: string): RenderedEmail {
  const heading = `Thank you, ${order.customerName}`;
  const address = formatAddress(order.shippingAddress);

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">We have received your order <strong>${escapeHtml(order.orderNumber)}</strong> and your payment of <strong>${escapeHtml(formatRupees(order.totalAmount))}</strong> has been confirmed.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${order.items.map(itemRow).join('')}</table>
    ${totalsTable(order)}
    <p style="margin:24px 0 6px 0;font-weight:600;color:#1c1c1a;">Shipping to</p>
    <p style="margin:0;color:#3d3d38;">${address.map(escapeHtml).join('<br>')}</p>
    <p style="margin:24px 0 0 0;">
      <a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:#1c1c1a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;font-weight:600;">View your order</a>
    </p>`;

  const text = [
    `Thank you, ${order.customerName}.`,
    '',
    `We have received your order ${order.orderNumber}.`,
    `Payment confirmed: ${formatRupees(order.totalAmount)}`,
    '',
    ...order.items.map(
      (item) =>
        `- ${item.title} (${item.colour}, size ${item.size}, ${item.sku}) x${item.quantity} = ${formatRupees(item.lineTotal)}`,
    ),
    '',
    `Subtotal: ${formatRupees(order.subtotal)}`,
    ...(order.discountAmount > 0 ? [`Discount: -${formatRupees(order.discountAmount)}`] : []),
    ...(order.taxAmount > 0 ? [`Tax: ${formatRupees(order.taxAmount)}`] : []),
    `Shipping: ${formatRupees(order.shippingFee)}`,
    `Total: ${formatRupees(order.totalAmount)}`,
    '',
    'Shipping to:',
    ...address,
    '',
    `View your order: ${orderUrl}`,
  ].join('\n');

  return {
    subject: `Order ${order.orderNumber} confirmed`,
    html: layout({
      heading,
      bodyHtml,
      footerNote: `You are receiving this email because you placed an order with ${BRAND}.`,
    }),
    text,
    tag: 'order-confirmation',
  };
}

/** The order has been handed to the courier. */
export function renderOrderShipped(
  order: Order,
  input: { courierName?: string | null; awbCode?: string | null; trackingUrl?: string | null },
): RenderedEmail {
  const heading = `Your order ${order.orderNumber} is on its way`;
  const courier = input.courierName ? ` via ${input.courierName}` : '';

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">We have dispatched your order${escapeHtml(courier)}.</p>
    ${input.awbCode ? `<p style="margin:0 0 16px 0;">Your tracking number is <strong style="font-family:Menlo,Consolas,monospace;">${escapeHtml(input.awbCode)}</strong>.</p>` : ''}
    ${input.trackingUrl ? `<p style="margin:0 0 16px 0;"><a href="${escapeHtml(input.trackingUrl)}" style="color:#1c1c1a;">Track your parcel</a></p>` : ''}
    <p style="margin:0;">It will be delivered to:</p>
    <p style="margin:6px 0 0 0;color:#3d3d38;">${formatAddress(order.shippingAddress).map(escapeHtml).join('<br>')}</p>`;

  const text = [
    `Your order ${order.orderNumber} is on its way${courier}.`,
    ...(input.awbCode ? [`Tracking number: ${input.awbCode}`] : []),
    ...(input.trackingUrl ? [`Track your parcel: ${input.trackingUrl}`] : []),
    '',
    'Delivering to:',
    ...formatAddress(order.shippingAddress),
  ].join('\n');

  return {
    subject: `Order ${order.orderNumber} shipped`,
    html: layout({
      heading,
      bodyHtml,
      footerNote: `You are receiving this email because you placed an order with ${BRAND}.`,
    }),
    text,
    tag: 'order-shipped',
  };
}

/** The order has been delivered. */
export function renderOrderDelivered(order: Order): RenderedEmail {
  const heading = `Order ${order.orderNumber} delivered`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">We hope you are happy with your purchase from ${escapeHtml(BRAND)}.</p>
    <p style="margin:0;">If something is not right, reply to this email and we will help.</p>`;

  const text = [
    `Order ${order.orderNumber} has been delivered.`,
    '',
    'If something is not right, reply to this email and we will help.',
  ].join('\n');

  return {
    subject: `Order ${order.orderNumber} delivered`,
    html: layout({
      heading,
      bodyHtml,
      footerNote: `You are receiving this email because you placed an order with ${BRAND}.`,
    }),
    text,
    tag: 'order-delivered',
  };
}

/** The order was cancelled. */
export function renderOrderCancelled(order: Order, reason?: string): RenderedEmail {
  const heading = `Order ${order.orderNumber} cancelled`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Your order has been cancelled.</p>
    ${reason ? `<p style="margin:0 0 16px 0;">Reason: ${escapeHtml(reason)}</p>` : ''}
    ${
      order.paymentMethod === 'razorpay' && order.paymentStatus === 'paid'
        ? `<p style="margin:0;">A refund of <strong>${escapeHtml(formatRupees(order.totalAmount))}</strong> has been initiated to your original payment method. It may take 5&ndash;7 working days to appear.</p>`
        : '<p style="margin:0;">No payment was taken for this order.</p>'
    }`;

  const text = [
    `Order ${order.orderNumber} has been cancelled.`,
    ...(reason ? [`Reason: ${reason}`] : []),
    '',
    order.paymentMethod === 'razorpay' && order.paymentStatus === 'paid'
      ? `A refund of ${formatRupees(order.totalAmount)} has been initiated. It may take 5-7 working days.`
      : 'No payment was taken for this order.',
  ].join('\n');

  return {
    subject: `Order ${order.orderNumber} cancelled`,
    html: layout({
      heading,
      bodyHtml,
      footerNote: `You are receiving this email because you placed an order with ${BRAND}.`,
    }),
    text,
    tag: 'order-cancelled',
  };
}

/** A return request was received. */
export function renderReturnAcknowledged(request: ReturnRequest): RenderedEmail {
  const heading = `We have your return request ${request.returnNumber}`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Thank you. We have received your return request for order <strong>${escapeHtml(request.orderNumber)}</strong>.</p>
    <p style="margin:0 0 16px 0;">We will review it and let you know. You do not need to do anything else right now.</p>
    <p style="margin:0;color:#7a7a72;font-size:14px;">Items: ${escapeHtml(request.items.map((item) => `${item.title} (${item.colour}, size ${item.size}) x${item.quantity}`).join(', '))}</p>`;

  const text = [
    `We have received your return request ${request.returnNumber} for order ${request.orderNumber}.`,
    '',
    'We will review it and let you know.',
  ].join('\n');

  return {
    subject: `Return ${request.returnNumber} received`,
    html: layout({
      heading,
      bodyHtml,
      footerNote: `You are receiving this email because you requested a return with ${BRAND}.`,
    }),
    text,
    tag: 'return-acknowledged',
  };
}

/** A return was approved. */
export function renderReturnApproved(request: ReturnRequest): RenderedEmail {
  const heading = `Return ${request.returnNumber} approved`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Your return for order <strong>${escapeHtml(request.orderNumber)}</strong> has been approved.</p>
    <p style="margin:0 0 16px 0;">The approved refund amount is <strong>${escapeHtml(formatRupees(request.refundAmount))}</strong>.</p>
    <p style="margin:0;">Please follow the return instructions you have received. We will process the refund once the item reaches us.</p>`;

  const text = [
    `Return ${request.returnNumber} for order ${request.orderNumber} has been approved.`,
    `Approved refund: ${formatRupees(request.refundAmount)}`,
    '',
    'Please follow the return instructions. We will process the refund once the item reaches us.',
  ].join('\n');

  return {
    subject: `Return ${request.returnNumber} approved`,
    html: layout({
      heading,
      bodyHtml,
      footerNote: `You are receiving this email because you requested a return with ${BRAND}.`,
    }),
    text,
    tag: 'return-approved',
  };
}

/**
 * A refund was confirmed by the provider.
 *
 * This template exists separately from `return-approved` because the two
 * statements are genuinely different:
 *
 *  - "approved" means **we** decided to refund you. No money has moved.
 *  - "refunded" means the provider confirmed the money is on its way back.
 *
 * Sending the approved notice as if it were a refund would be a false
 * statement about the customer's money, so the wording is deliberately
 * distinct and the `refunded` template is only ever rendered once the
 * provider has confirmed the refund.
 */
export function renderReturnRefunded(
  request: ReturnRequest,
  refundReference?: string | null,
): RenderedEmail {
  const heading = `Refund issued for return ${request.returnNumber}`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">We have issued a refund of <strong>${escapeHtml(formatRupees(request.refundAmount))}</strong> for your return on order <strong>${escapeHtml(request.orderNumber)}</strong>.</p>
    ${
      refundReference
        ? `<p style="margin:0 0 16px 0;">Your refund reference is <strong style="font-family:Menlo,Consolas,monospace;">${escapeHtml(refundReference)}</strong>.</p>`
        : ''
    }
    <p style="margin:0;">The amount is on its way back to your original payment method. Depending on your bank it may take 5&ndash;7 working days to appear on your statement.</p>`;

  const text = [
    `We have issued a refund of ${formatRupees(request.refundAmount)} for return ${request.returnNumber} on order ${request.orderNumber}.`,
    ...(refundReference ? [`Your refund reference is ${refundReference}.`] : []),
    '',
    'The amount is on its way back to your original payment method. It may take 5-7 working days to appear.',
  ].join('\n');

  return {
    subject: `Refund issued for return ${request.returnNumber}`,
    html: layout({
      heading,
      bodyHtml,
      footerNote: `You are receiving this email because you requested a return with ${BRAND}.`,
    }),
    text,
    tag: 'return-refunded',
  };
}

/**
 * A password reset link.
 *
 * The link is the only sensitive value in the message, so it is rendered
 * last and the raw token is never echoed into any other field. The template
 * deliberately contains no expiry countdown claim: the token lifetime is a
 * server-side policy, and stating a number here that disagrees with the code
 * would be a small lie in a security-relevant email.
 */
export function renderPasswordReset(input: {
  customerName: string;
  resetUrl: string;
  requestIp?: string | null;
}): RenderedEmail {
  const heading = 'Reset your password';

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hello ${escapeHtml(input.customerName)},</p>
    <p style="margin:0 0 16px 0;">We received a request to reset the password for your ${escapeHtml(BRAND)} account. Use the button below to choose a new one.</p>
    <p style="margin:0 0 16px 0;">
      <a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;background:#1c1c1a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;font-weight:600;">Choose a new password</a>
    </p>
    <p style="margin:0 0 16px 0;color:#7a7a72;font-size:14px;">If the button does not work, copy this link into your browser:</p>
    <p style="margin:0 0 16px 0;font-family:Menlo,Consolas,monospace;font-size:13px;word-break:break-all;"><a href="${escapeHtml(input.resetUrl)}" style="color:#1c1c1a;">${escapeHtml(input.resetUrl)}</a></p>
    <p style="margin:0;">If you did not request this, you can ignore this email. Your password will not change unless you use the link above.</p>`;

  const text = [
    `Hello ${input.customerName},`,
    '',
    `We received a request to reset the password for your ${BRAND} account.`,
    '',
    `Choose a new password: ${input.resetUrl}`,
    '',
    'If you did not request this, you can ignore this email. Your password will not change unless you use the link above.',
  ].join('\n');

  return {
    subject: `Reset your ${BRAND} password`,
    html: layout({
      heading,
      bodyHtml,
      footerNote: `You are receiving this email because a password reset was requested for your ${BRAND} account.`,
    }),
    text,
    tag: 'password-reset',
  };
}

/** A return was rejected. */
export function renderReturnRejected(request: ReturnRequest, note?: string): RenderedEmail {
  const heading = `Return ${request.returnNumber} not approved`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">We are sorry &mdash; your return for order <strong>${escapeHtml(request.orderNumber)}</strong> has not been approved.</p>
    ${note ? `<p style="margin:0 0 16px 0;">${escapeHtml(note)}</p>` : ''}
    <p style="margin:0;">If you think this is a mistake, reply to this email and we will take another look.</p>`;

  const text = [
    `Return ${request.returnNumber} for order ${request.orderNumber} has not been approved.`,
    ...(note ? ['', note] : []),
    '',
    'If you think this is a mistake, reply to this email.',
  ].join('\n');

  return {
    subject: `Return ${request.returnNumber} not approved`,
    html: layout({
      heading,
      bodyHtml,
      footerNote: `You are receiving this email because you requested a return with ${BRAND}.`,
    }),
    text,
    tag: 'return-rejected',
  };
}
