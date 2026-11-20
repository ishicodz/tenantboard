import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, ws } from "../../api";
import { useSlug, useWorkspace } from "../../hooks";
import type { Limits, Plan, Usage } from "../../types";
import { UsageBar, fmtDate, useToast } from "../../components/ui";

interface BillingInfo {
  plan: Plan;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  hasStripeCustomer: boolean;
  usage: Usage;
  limits: Limits;
  catalog: { plan: Plan; name: string; priceMonthly: number; blurb: string; limits: Limits }[];
  stripeEnabled: boolean;
  devBillingEnabled: boolean;
}

const lim = (n: number | null) => (n === null ? "Unlimited" : n === 0 ? "—" : String(n));

export function BillingPage() {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data: wsd } = useWorkspace();
  const isOwner = wsd?.role === "OWNER";
  const { data } = useQuery({ queryKey: ["billing", slug], queryFn: () => api.get<BillingInfo>(ws(slug, "/billing")) });

  useEffect(() => {
    const c = params.get("checkout");
    if (c === "success") toast("Payment received. Your plan updates as soon as Stripe confirms it.", "success");
    if (c === "cancelled") toast("Checkout cancelled", "info");
    if (c) {
      setParams({}, { replace: true });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["billing", slug] }), 2500);
    }
  }, [params, setParams, toast, qc, slug]);

  const onErr = (e: ApiError) => toast(e.message, "error");
  const checkout = useMutation({
    mutationFn: (plan: Plan) => api.post<{ url: string }>(ws(slug, "/billing/checkout"), { plan }),
    onSuccess: ({ url }) => (window.location.href = url),
    onError: onErr,
  });
  const portal = useMutation({
    mutationFn: () => api.post<{ url: string }>(ws(slug, "/billing/portal")),
    onSuccess: ({ url }) => (window.location.href = url),
    onError: onErr,
  });
  const devSet = useMutation({
    mutationFn: (plan: Plan) => api.post(ws(slug, "/billing/dev-set-plan"), { plan }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast("Plan changed (dev mode)", "success");
    },
    onError: onErr,
  });

  if (!data) return null;
  const order: Plan[] = ["FREE", "PRO", "BUSINESS"];

  return (
    <div className="page">
      <h1>Billing</h1>
      <p className="muted">
        Current plan: <strong>{data.plan}</strong>
        {data.subscriptionStatus && ` · ${data.subscriptionStatus}`}
        {data.currentPeriodEnd && ` · renews ${fmtDate(data.currentPeriodEnd)}`}
      </p>

      <div className="grid-4 mt">
        <UsageBar label="Projects" used={data.usage.projects} limit={data.limits.projects} />
        <UsageBar label="Members" used={data.usage.members} limit={data.limits.members} />
        <UsageBar label="Issues" used={data.usage.issues} limit={data.limits.issues} />
        <UsageBar label="Webhooks" used={data.usage.webhooks} limit={data.limits.webhooks} />
      </div>

      <div className="plans mt">
        {data.catalog.map((p) => {
          const current = p.plan === data.plan;
          const upgrade = order.indexOf(p.plan) > order.indexOf(data.plan);
          return (
            <div key={p.plan} className={`plan ${current ? "plan-current" : ""}`}>
              <div className="plan-name">{p.name}</div>
              <div className="plan-price">
                ${p.priceMonthly}
                <span className="muted small">/mo</span>
              </div>
              <div className="muted small">{p.blurb}</div>
              <ul className="plan-limits">
                <li>{lim(p.limits.projects)} projects</li>
                <li>{lim(p.limits.members)} members</li>
                <li>{lim(p.limits.issues)} issues</li>
                <li>{p.limits.webhooks ? `${p.limits.webhooks} webhooks` : "No webhooks"}</li>
                <li>{p.limits.maxAttachmentMb} MB attachments</li>
              </ul>
              {current ? (
                <span className="pill pill-green">Current plan</span>
              ) : isOwner && upgrade && data.stripeEnabled && data.plan === "FREE" ? (
                <button className="btn btn-primary" onClick={() => checkout.mutate(p.plan)} disabled={checkout.isPending}>
                  Upgrade with Stripe
                </button>
              ) : null}
              {isOwner && data.devBillingEnabled && !current && (
                <button className="btn btn-ghost btn-small" onClick={() => devSet.mutate(p.plan)}>
                  Switch (dev only)
                </button>
              )}
            </div>
          );
        })}
      </div>

      {isOwner && data.hasStripeCustomer && data.stripeEnabled && (
        <button className="btn mt" onClick={() => portal.mutate()}>
          Manage subscription in Stripe
        </button>
      )}
      {!data.stripeEnabled && (
        <div className="callout mt">
          Stripe is not configured on this server. Set <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_WEBHOOK_SECRET</code> and the price IDs to enable test-mode checkout.
        </div>
      )}
      {!isOwner && <p className="muted mt">Only workspace owners can change the plan.</p>}
      <p className="muted small mt">Test card: 4242 4242 4242 4242, any future date, any CVC.</p>
    </div>
  );
}
