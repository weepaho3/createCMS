'use client';

import { Tooltip } from '@base-ui/react/tooltip';
import {
  CornerDownLeft,
  CornerDownRight,
  Globe,
  Lock,
  Monitor,
  Server,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useState } from 'react';

import { cn } from '../lib/cn';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const methodVariants: Record<HttpMethod, string> = {
  GET: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  POST: 'text-sky-700 dark:text-sky-400 bg-sky-500/10 border-sky-500/25',
  PUT: 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/25',
  PATCH:
    'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/25',
  DELETE: 'text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/25',
};

export interface APIParam {
  /** Short type signature, e.g. `string`, `number`, `'asc' | 'desc'`. */
  type: ReactNode;
  /** One-line description. */
  description?: ReactNode;
  /** Whether the field is required. */
  required?: boolean;
  /** Default value, rendered as `= <default>`. */
  default?: string;
}

export interface APIReturn {
  /** Short type signature of this field, e.g. `string`, `RootListItem[]`, `boolean`. */
  type: ReactNode;
  /** What the field is. */
  description?: ReactNode;
  /** The field is only present in some responses (not always returned). */
  optional?: boolean;
}

export interface ApiMethodCardProps {
  method: HttpMethod;
  path: string;
  defaultTab?: 'server' | 'client';
  resource?: string;
  operation?: string;
  public?: boolean;
  anonymousRead?: boolean;
  params?: Record<string, APIParam>;
  returns?: Record<string, APIReturn>;
  serverCode: ReactNode;
  clientCode: ReactNode;
}

export function ApiMethodCard({
  method,
  path,
  defaultTab = 'client',
  resource,
  operation,
  public: isPublic,
  anonymousRead,
  params,
  returns,
  serverCode,
  clientCode,
}: ApiMethodCardProps) {
  const [tab, setTab] = useState<'server' | 'client'>(defaultTab);

  return (
    <div className="not-prose my-6 overflow-hidden rounded-2xl border bg-fd-card text-fd-card-foreground">
      {/* Client / Server tabs + permission chip */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b bg-fd-muted/40 p-1.5">
        <TabButton
          active={tab === 'client'}
          onClick={() => setTab('client')}
          icon={<Monitor className="size-3" />}
        >
          Client
        </TabButton>
        <TabButton
          active={tab === 'server'}
          onClick={() => setTab('server')}
          icon={<Server className="size-3" />}
        >
          Server
        </TabButton>
        <span className="ms-auto pe-1">
          <AuthBadge
            resource={resource}
            operation={operation}
            isPublic={isPublic}
            anonymousRead={anonymousRead}
          />
        </span>
      </div>

      {/* Method + path */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2">
        <span
          className={cn(
            'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide',
            methodVariants[method],
          )}
        >
          {method}
        </span>
        <code className="break-all font-mono text-sm text-fd-foreground">
          {path}
        </code>
      </div>

      {/* Code sample (pre-highlighted server-side) */}
      <div className={tab === 'server' ? undefined : 'hidden'}>
        {serverCode}
      </div>
      <div className={tab === 'client' ? undefined : 'hidden'}>
        {clientCode}
      </div>

      {/* Parameters */}
      {params && Object.keys(params).length > 0 && (
        <div className="border-t">
          <div className="flex items-center gap-1.5 border-b bg-fd-muted/30 px-3 py-1.5 text-xs font-medium text-fd-muted-foreground">
            <CornerDownRight className="size-3" />
            Parameters
          </div>
          <div className="flex flex-col">
            {Object.entries(params).map(([name, p]) => (
              <div
                key={name}
                className="flex flex-col gap-1 border-b px-3 py-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <code className="rounded-md border bg-fd-background px-1.5 py-0.5 font-mono text-sm font-medium text-fd-foreground">
                    {name}
                  </code>
                  <span className="font-mono text-xs text-fd-muted-foreground">
                    {p.type}
                  </span>
                  {p.default !== undefined && (
                    <span className="font-mono text-xs text-fd-muted-foreground">
                      = {p.default}
                    </span>
                  )}
                  {p.required && (
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-500">
                      required
                    </span>
                  )}
                </div>
                {p.description && (
                  <p className="text-sm text-fd-muted-foreground">
                    {p.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Returns */}
      {returns && Object.keys(returns).length > 0 && (
        <div className="border-t bg-fd-muted/10">
          <div className="flex items-center gap-1.5 border-b bg-fd-muted/30 px-3 py-1.5 text-xs font-medium text-fd-muted-foreground">
            <CornerDownLeft className="size-3" />
            Returns
          </div>
          <div className="flex flex-col">
            {Object.entries(returns).map(([name, r]) => (
              <div
                key={name}
                className="flex flex-col gap-1 border-b px-3 py-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <code className="rounded-md border bg-fd-background px-1.5 py-0.5 font-mono text-sm font-medium text-fd-foreground">
                    {name}
                  </code>
                  <span className="font-mono text-xs text-fd-muted-foreground">
                    {r.type}
                  </span>
                  {r.optional && (
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                      optional
                    </span>
                  )}
                </div>
                {r.description && (
                  <p className="text-sm text-fd-muted-foreground">
                    {r.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-fd-background text-fd-foreground shadow-sm'
          : 'text-fd-muted-foreground hover:text-fd-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Tip({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactElement;
}) {
  return (
    <Tooltip.Provider delay={150}>
      <Tooltip.Root>
        <Tooltip.Trigger render={children} />
        <Tooltip.Portal>
          <Tooltip.Positioner
            side="bottom"
            align="end"
            sideOffset={6}
            className="z-50"
          >
            <Tooltip.Popup className="max-w-[17rem] rounded-lg border bg-fd-popover px-3 py-2 shadow-lg">
              {content}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function TipBody({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="text-xs leading-relaxed [&_code]:font-mono [&_code]:text-fd-foreground">
      <p className="font-medium text-fd-foreground">{title}</p>
      <p className="mt-0.5 text-fd-muted-foreground">{children}</p>
    </div>
  );
}

function AuthBadge({
  resource,
  operation,
  isPublic,
  anonymousRead,
}: {
  resource?: string;
  operation?: string;
  isPublic?: boolean;
  anonymousRead?: boolean;
}) {
  if (isPublic) {
    return (
      <Tip
        content={
          <TipBody title="Public endpoint">
            The only route that skips <code>authMiddleware</code> entirely and
            handles its own access. Reachable with no session.
          </TipBody>
        }
      >
        <span className="inline-flex cursor-default items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <Globe className="size-3" />
          Public
        </span>
      </Tip>
    );
  }
  if (anonymousRead) {
    return (
      <Tip
        content={
          <TipBody title="Anonymous read">
            Still runs your <code>authMiddleware</code> (so plugin scope like
            multi-tenant and i18n resolves), passing the{' '}
            <code>{resource ?? 'publishedContent'}</code> resource. You
            conventionally allow that one for logged-out visitors.
          </TipBody>
        }
      >
        <span className="inline-flex cursor-default items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          <Globe className="size-3" />
          Anonymous read
        </span>
      </Tip>
    );
  }
  return (
    <Tip
      content={
        <TipBody title="Passed to your middleware">
          {resource && operation ? (
            <>
              On every call, createCMS hands your <code>authMiddleware</code>{' '}
              this resource and operation (as{' '}
              <code>ctx.permissionResource</code> and <code>ctx.operation</code>
              ). Your middleware decides whether to allow, deny, or scope the
              call. createCMS enforces nothing on its own.
            </>
          ) : (
            'Your authMiddleware resolves a session before this endpoint runs.'
          )}
        </TipBody>
      }
    >
      <span className="inline-flex cursor-default items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium text-fd-muted-foreground">
        <Lock className="size-3" />
        {resource && operation ? (
          <code className="font-mono">
            {resource}:{operation}
          </code>
        ) : (
          'Requires session'
        )}
      </span>
    </Tip>
  );
}
