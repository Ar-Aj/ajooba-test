import Link from 'next/link';
import { Search } from 'lucide-react';
import { EmptyState, HeaderFact, PageHeader, Panel } from '@/components/layout/page-header';
import { Pagination, queryString } from '@/components/ui/pagination';
import { Status } from '@/components/ui/status';
import { OpsApiError, fetchCustomers, type CustomerRow, type Page } from '@/lib/ops';
import { dateOnly, relativeTime } from '@/lib/format';

/**
 * Customers.
 *
 * ## What this screen does not do
 *
 * It does not edit a customer. There is no "change email" control and no password
 * reset issued from here, because both are account-takeover primitives and the
 * API exposes neither â€” a customer changes their own details, having proved who
 * they are. The panel lists, searches, and tells an operator whether an account
 * is active.
 *
 * ## Why there is no order count or lifetime value column
 *
 * Those figures exist, and they belong on the orders screen where they can be
 * filtered by window. Putting an all-time total beside a customer here would
 * invite a comparison between customers of very different ages, which is the
 * most common way a dashboard misleads its reader. The column that earns its
 * place is "last seen", because it answers the question this screen is opened
 * for: *is this person still around?*
 */

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const search = firstValue(params.search)?.trim() || undefined;
  const page = Math.max(1, Number(firstValue(params.page)) || 1);

  let result: Page<CustomerRow> | null = null;
  let failure: string | null = null;

  try {
    result = await fetchCustomers({
      ...(search ? { search } : {}),
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    failure = error instanceof OpsApiError ? error.message : 'The customers could not be read.';
  }

  const hrefFor = (next: Record<string, string | number | undefined>) =>
    `/customers${queryString({ search, page: next.page })}`;

  return (
    <>
      <PageHeader
        eyebrow="Sell Â· Customers"
        title="Customers"
        description="Every customer account on the storefront. Search matches name, email and phone. This screen is read-only: an account's details can only be changed by its owner."
        meta={
          result ? (
            <>
              <HeaderFact label="Accounts" value={result.totalItems} />
              {search ? <HeaderFact label="Search" value={`â€œ${search}â€`} /> : null}
            </>
          ) : null
        }
        actions={
          <form action="/customers" method="get" className="flex items-center gap-2">
            <label htmlFor="customer-search" className="sr-only">
              Search customers
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <input
                id="customer-search"
                name="search"
                type="search"
                defaultValue={search ?? ''}
                placeholder="Name, email or phone"
                className="field w-56 pl-8"
              />
            </div>
            <button type="submit" className="btn btn-secondary btn-sm">
              Search
            </button>
          </form>
        }
      />

      <div className="page-body">
        {failure ? (
          <div className="sheet p-6" role="alert">
            <p className="step-md font-medium text-ink-900">The customers could not be read</p>
            <p className="step-sm mt-1.5 text-ink-600">{failure}</p>
            <p className="step-sm mt-3 text-ink-500">Nothing has been changed. Reload to retry.</p>
          </div>
        ) : (
          <Panel flush>
            {!result || result.items.length === 0 ? (
              <EmptyState
                title={search ? 'No customers match that search' : 'No customer accounts yet'}
                description={
                  search
                    ? 'Try a shorter term â€” the search matches part of a name, email or phone number.'
                    : 'Accounts appear here when a shopper registers. A guest checkout does not create one.'
                }
                action={
                  search ? (
                    <Link href="/customers" className="btn btn-secondary">
                      Clear search
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Customer</th>
                        <th scope="col">Phone</th>
                        <th scope="col">Joined</th>
                        <th scope="col">Last seen</th>
                        <th scope="col">Account</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((customer) => (
                        <tr key={customer.id}>
                          <td className="max-w-[20rem]">
                            <span className="block truncate text-ink-900">
                              {customer.firstName} {customer.lastName}
                            </span>
                            <span className="block truncate text-[0.75rem] text-ink-400">
                              {customer.email}
                            </span>
                          </td>
                          <td className="whitespace-nowrap tabular-nums text-ink-700">
                            {customer.phone}
                          </td>
                          <td
                            className="whitespace-nowrap text-ink-600"
                            title={dateOnly(customer.createdAt)}
                          >
                            {relativeTime(customer.createdAt)}
                          </td>
                          <td className="whitespace-nowrap text-ink-600">
                            {customer.lastLoginAt ? relativeTime(customer.lastLoginAt) : 'Never'}
                          </td>
                          <td>
                            <Status tone={customer.isActive ? 'active' : 'fault'}>
                              {customer.isActive ? 'Active' : 'Disabled'}
                            </Status>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={result.page}
                  pageSize={PAGE_SIZE}
                  totalItems={result.totalItems}
                  totalPages={result.totalPages}
                  hrefFor={(next) => hrefFor({ page: next === 1 ? undefined : next })}
                />
              </>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
