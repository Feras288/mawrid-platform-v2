"use client";

import { Heart, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import {
  addToCartAction,
  advanceGroupAction,
  cancelOrderAction,
  checkoutAction,
  decideReturnAction,
  deleteAddressAction,
  deleteZoneAction,
  removeCartItemAction,
  requestReturnAction,
  retryPaymentAction,
  saveAddressAction,
  saveZoneAction,
  simulateTestPaymentAction,
  supplierCancelAction,
  toggleWishlistAction,
  updateCartItemAction,
} from "@/app/actions/store";
import { ActionButton, ActionForm, Field, FormError, SubmitButton, useErrorMessage } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Button, Checkbox, Input, Select } from "@/components/ui/primitives";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const fmtQty = (v: string) => String(Number(v));

// ------------------------------------------------------------------------------------- product

export function AddToCart({ productId, moq, step, disabled, signedIn }: { productId: string; moq: string; step: string; disabled: boolean; signedIn: boolean }) {
  const t = useTranslations("store");
  const router = useRouter();
  const err = useErrorMessage();
  const [qty, setQty] = React.useState(fmtQty(moq));
  const [pending, start] = React.useTransition();
  const n = (v: string) => Number(v) || 0;
  if (!signedIn)
    return (
      <Button onClick={() => router.push("/login")} className="w-full sm:w-auto">
        {t("signInToBuy")}
      </Button>
    );
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex items-center rounded-lg border border-sand-300">
        <Button variant="ghost" size="icon" aria-label="-" onClick={() => setQty(String(Math.max(n(moq), n(qty) - n(step))))} disabled={disabled || n(qty) <= n(moq)}>
          <Minus />
        </Button>
        <Input aria-label={t("quantity")} value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="h-9 w-20 border-0 text-center" dir="ltr" />
        <Button variant="ghost" size="icon" aria-label="+" onClick={() => setQty(String(n(qty) + n(step)))} disabled={disabled}>
          <Plus />
        </Button>
      </div>
      <Button
        variant="accent"
        disabled={disabled || pending}
        aria-busy={pending}
        onClick={() =>
          start(async () => {
            const r = await addToCartAction(productId, qty);
            if (r.ok) {
              toast.success(t("added"));
              router.refresh();
            } else toast.error(err(r.error));
          })
        }
      >
        <ShoppingCart />
        {t("addToCart")}
      </Button>
    </div>
  );
}

export function WishlistButton({ productId, active }: { productId: string; active: boolean }) {
  const t = useTranslations("store");
  const router = useRouter();
  const [on, setOn] = React.useState(active);
  const [pending, start] = React.useTransition();
  return (
    <Button
      variant="outline"
      aria-pressed={on}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await toggleWishlistAction(productId);
          if (r.ok) {
            setOn(Boolean(r.data));
            router.refresh();
          }
        })
      }
    >
      <Heart className={cn(on && "fill-danger-600 text-danger-600")} />
      {on ? t("wishlistRemove") : t("wishlistAdd")}
    </Button>
  );
}

// ------------------------------------------------------------------------------------- cart

export function CartQty({ itemId, quantity }: { itemId: string; quantity: string }) {
  const t = useTranslations("store");
  return (
    <ActionForm action={updateCartItemAction} className="flex items-center gap-1 space-y-0">
      <input type="hidden" name="itemId" value={itemId} />
      <Input name="quantity" aria-label={t("quantity")} defaultValue={fmtQty(quantity)} inputMode="decimal" className="h-8 w-20" dir="ltr" />
      <SubmitButton size="sm" variant="ghost">
        {t("update")}
      </SubmitButton>
    </ActionForm>
  );
}

export function RemoveCartItem({ itemId }: { itemId: string }) {
  const t = useTranslations("store");
  return (
    <ActionButton size="icon" variant="ghost" aria-label={t("remove")} action={() => removeCartItemAction(itemId)}>
      <Trash2 />
    </ActionButton>
  );
}

// ------------------------------------------------------------------------------------- checkout

type CheckoutGroup = { supplierOrgId: string; supplierName: string; options: { method: string; label: string; fee: string; eta: string; free: boolean }[] };

export function CheckoutForm({ addresses, addressId, groups, methods, canSubmit, totalLabel }: { addresses: Opt[]; addressId: string | null; groups: CheckoutGroup[]; methods: { card: boolean; bankTransfer: boolean }; canSubmit: boolean; totalLabel: string }) {
  const t = useTranslations("store");
  const router = useRouter();
  const key = React.useMemo(newKey, []);
  const onCity = (id: string) => router.replace(`/checkout?address=${id}`);
  return (
    <ActionForm
      action={checkoutAction}
      refresh={false}
      onSuccess={(r: { orderId: string; redirectUrl: string | null; paymentError: string | null }) => {
        if (r.redirectUrl) window.location.assign(r.redirectUrl);
        else router.push(`/account/orders/${r.orderId}`);
      }}
      successMessage={t("orderPlaced")}
    >
      <FormError />
      <input type="hidden" name="idempotencyKey" value={key} />
      <fieldset className="space-y-2">
        <legend className="mb-1 font-semibold">{t("deliverTo")}</legend>
        {addresses.map((a) => (
          <label key={a.value} className="flex items-start gap-2 rounded-lg border border-sand-200 p-3 text-sm has-[:checked]:border-primary-600 has-[:checked]:bg-primary-50">
            <input type="radio" name="addressId" value={a.value} defaultChecked={a.value === addressId} onChange={() => onCity(a.value)} className="mt-1 accent-primary-700" required />
            <span>{a.label}</span>
          </label>
        ))}
      </fieldset>
      {groups.map((g) => (
        <fieldset key={g.supplierOrgId} className="space-y-2">
          <legend className="mb-1 font-semibold">{t("shipmentFrom", { supplier: g.supplierName })}</legend>
          <input type="hidden" name="supplierOrgId[]" value={g.supplierOrgId} />
          {g.options.length === 0 ? (
            <p className="text-sm text-danger-600">{t("noShipping")}</p>
          ) : (
            <Select name="method[]" aria-label={t("shippingMethod")} defaultValue={g.options[0]!.method}>
              {g.options.map((o) => (
                <option key={o.method} value={o.method}>
                  {o.label} — {o.free ? t("free") : o.fee} · {o.eta}
                </option>
              ))}
            </Select>
          )}
        </fieldset>
      ))}
      <fieldset className="space-y-2">
        <legend className="mb-1 font-semibold">{t("payment")}</legend>
        {!methods.card && !methods.bankTransfer ? <p className="text-sm text-warning-600">{t("paymentUnavailable")}</p> : null}
        {methods.card ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="paymentMethod" value="card" defaultChecked className="accent-primary-700" />
            {t("card")}
          </label>
        ) : null}
        {methods.bankTransfer ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="paymentMethod" value="bank_transfer" defaultChecked={!methods.card} className="accent-primary-700" />
            {t("bankTransfer")}
          </label>
        ) : null}
      </fieldset>
      <Field name="buyerVatNumber" label={t("buyerVat")} inputMode="numeric" dir="ltr" maxLength={15} />
      <Checkbox name="acceptTerms" value="1" required label={t("acceptTerms")} />
      <p className="text-xs text-ink-500">{t("sellerOfRecord")}</p>
      <SubmitButton variant="accent" size="lg" className="w-full" disabled={!canSubmit || (!methods.card && !methods.bankTransfer)}>
        {t("placeOrder")}{totalLabel ? ` · ${totalLabel}` : ""}
      </SubmitButton>
    </ActionForm>
  );
}

export function TestPayButtons({ intentId }: { intentId: string }) {
  const t = useTranslations("store.testPay");
  const router = useRouter();
  const err = useErrorMessage();
  const [pending, start] = React.useTransition();
  const go = (outcome: "succeeded" | "failed") =>
    start(async () => {
      const r = await simulateTestPaymentAction(intentId, outcome);
      if (r.ok) router.push(`/checkout/result?order=${r.data.orderId}`);
      else toast.error(err(r.error));
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="accent" disabled={pending} onClick={() => go("succeeded")}>
        {t("succeed")}
      </Button>
      <Button variant="outline" disabled={pending} onClick={() => go("failed")}>
        {t("fail")}
      </Button>
    </div>
  );
}

export function PayNowButton({ orderId }: { orderId: string }) {
  const t = useTranslations("orders");
  const err = useErrorMessage();
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      variant="accent"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await retryPaymentAction(orderId);
          if (r.ok && r.data.redirectUrl) window.location.assign(r.data.redirectUrl);
          else if (r.ok) router.refresh();
          else toast.error(err(r.error));
        })
      }
    >
      {t("payNow")}
    </Button>
  );
}

export function CancelOrderDialog({ orderId, groupId, label }: { orderId: string; groupId?: string; label: string }) {
  const t = useTranslations("orders");
  return (
    <Modal title={label} trigger={<Button variant="ghost" size="sm" className="text-danger-600">{label}</Button>}>
      <ActionForm action={cancelOrderAction} successMessage={t("saved")}>
        <FormError />
        <input type="hidden" name="orderId" value={orderId} />
        {groupId ? <input type="hidden" name="groupId" value={groupId} /> : null}
        <Field as="textarea" name="reason" required label={t("cancelReason")} />
        <SubmitButton variant="danger">{label}</SubmitButton>
      </ActionForm>
    </Modal>
  );
}

export function ReturnDialog({ groupId, lines }: { groupId: string; lines: { id: string; name: string; max: string }[] }) {
  const t = useTranslations("orders");
  return (
    <Modal wide title={t("requestReturn")} trigger={<Button variant="outline" size="sm">{t("requestReturn")}</Button>}>
      <ActionForm action={requestReturnAction} successMessage={t("saved")}>
        <FormError />
        <input type="hidden" name="groupId" value={groupId} />
        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
              <span>{l.name}</span>
              <input type="hidden" name="orderLineId[]" value={l.id} />
              <Input name="quantity[]" aria-label={`${t("returnQty")} — ${l.name}`} defaultValue="0" inputMode="decimal" className="w-24" dir="ltr" max={l.max} />
            </div>
          ))}
        </div>
        <Field as="textarea" name="reason" required label={t("returnReason")} />
        <SubmitButton>{t("requestReturn")}</SubmitButton>
      </ActionForm>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------- addresses

export function AddressDialog({ cities, address }: { cities: Opt[]; address?: Record<string, string | boolean | null> & { id: string } }) {
  const t = useTranslations("addresses");
  const c = useTranslations("common");
  return (
    <Modal wide title={address ? c("edit") : t("new")} trigger={address ? <Button size="sm" variant="ghost">{c("edit")}</Button> : <Button>{t("new")}</Button>}>
      <ActionForm action={saveAddressAction} successMessage={c("saved")}>
        <FormError />
        {address ? <input type="hidden" name="id" value={address.id} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="label" label={t("label")} defaultValue={(address?.label as string) ?? ""} />
          <Field name="recipientName" required label={t("recipient")} defaultValue={(address?.recipientName as string) ?? ""} autoComplete="name" />
          <Field name="phone" required label={t("phone")} defaultValue={(address?.phone as string) ?? ""} inputMode="tel" dir="ltr" autoComplete="tel" />
          <Field as="select" name="city" required label={t("city")} defaultValue={(address?.city as string) ?? ""} placeholder={c("select")} options={cities} />
          <Field name="line1" required label={t("line1")} defaultValue={(address?.line1 as string) ?? ""} className="sm:col-span-2" autoComplete="address-line1" />
          <Field name="line2" label={t("line2")} defaultValue={(address?.line2 as string) ?? ""} />
          <Field name="district" label={t("district")} defaultValue={(address?.district as string) ?? ""} />
          <Field name="postalCode" label={t("postalCode")} defaultValue={(address?.postalCode as string) ?? ""} inputMode="numeric" dir="ltr" />
          <Field name="nationalAddressCode" label={t("nationalAddress")} defaultValue={(address?.nationalAddressCode as string) ?? ""} dir="ltr" />
        </div>
        <Checkbox name="isDefault" value="1" defaultChecked={Boolean(address?.isDefault)} label={t("makeDefault")} />
        <SubmitButton>{c("save")}</SubmitButton>
      </ActionForm>
    </Modal>
  );
}

export function DeleteAddressButton({ id }: { id: string }) {
  const c = useTranslations("common");
  return (
    <ActionButton size="sm" variant="ghost" className="text-danger-600" confirm={`${c("delete")}?`} action={() => deleteAddressAction(id)}>
      {c("delete")}
    </ActionButton>
  );
}

// ------------------------------------------------------------------------------------- supplier

export function SupplierGroupActions({ groupId, status }: { groupId: string; status: string }) {
  const t = useTranslations("orders");
  const step = (action: "prepare" | "deliver", label: string) => (
    <ActionForm action={advanceGroupAction} successMessage={t("saved")} className="space-y-0">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton>{label}</SubmitButton>
    </ActionForm>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {status === "confirmed" ? step("prepare", t("prepare")) : null}
      {status === "preparing" ? (
        <Modal title={t("ship")} trigger={<Button variant="accent">{t("ship")}</Button>}>
          <ActionForm action={advanceGroupAction} successMessage={t("saved")}>
            <FormError />
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="action" value="ship" />
            <Field name="carrier" required label={t("carrier")} />
            <Field name="trackingNumber" label={t("tracking")} dir="ltr" />
            <SubmitButton variant="accent">{t("ship")}</SubmitButton>
          </ActionForm>
        </Modal>
      ) : null}
      {status === "shipped" ? step("deliver", t("deliver")) : null}
      {["confirmed", "preparing"].includes(status) ? (
        <Modal title={t("supplierCancel")} trigger={<Button variant="ghost" className="text-danger-600">{t("supplierCancel")}</Button>}>
          <ActionForm action={supplierCancelAction} successMessage={t("saved")}>
            <FormError />
            <input type="hidden" name="groupId" value={groupId} />
            <Field as="textarea" name="reason" required label={t("cancelReason")} />
            <SubmitButton variant="danger">{t("supplierCancel")}</SubmitButton>
          </ActionForm>
        </Modal>
      ) : null}
    </div>
  );
}

export function ReturnDecision({ returnId, status }: { returnId: string; status: string }) {
  const t = useTranslations("orders");
  if (status === "approved")
    return (
      <ActionForm action={decideReturnAction} successMessage={t("saved")} className="space-y-0">
        <input type="hidden" name="returnId" value={returnId} />
        <input type="hidden" name="decision" value="receive" />
        <SubmitButton size="sm" variant="accent">
          {t("receiveReturn")}
        </SubmitButton>
      </ActionForm>
    );
  if (status !== "requested") return null;
  return (
    <ActionForm action={decideReturnAction} successMessage={t("saved")} className="flex flex-wrap items-end gap-2 space-y-0">
      <input type="hidden" name="returnId" value={returnId} />
      <Input name="note" aria-label={t("decisionNote")} placeholder={t("decisionNote")} className="h-8 w-48" />
      <SubmitButton size="sm" name="decision" value="approve">
        {t("approveReturn")}
      </SubmitButton>
      <SubmitButton size="sm" variant="outline" name="decision" value="reject">
        {t("rejectReturn")}
      </SubmitButton>
    </ActionForm>
  );
}

type Rate = { method: string; fee: string; freeOver: string | null; etaMinDays: number; etaMaxDays: number };
export function ZoneDialog({ zone, cities, regions }: { zone?: { id: string; name: string; nationwide: boolean; cities: string[]; regions: string[]; isActive: boolean; rates: Rate[] }; cities: Opt[]; regions: Opt[] }) {
  const t = useTranslations("shipping");
  const s = useTranslations("store");
  const c = useTranslations("common");
  const [nationwide, setNationwide] = React.useState(zone?.nationwide ?? true);
  const methods = ["standard", "express", "pickup"] as const;
  return (
    <Modal wide title={zone ? zone.name : t("newZone")} trigger={zone ? <Button size="sm" variant="outline">{c("edit")}</Button> : <Button>{t("newZone")}</Button>}>
      <ActionForm action={saveZoneAction} successMessage={c("saved")}>
        <FormError />
        {zone ? <input type="hidden" name="id" value={zone.id} /> : null}
        <Field name="name" required label={t("zoneName")} defaultValue={zone?.name ?? ""} />
        <Checkbox name="nationwide" value="1" checked={nationwide} onChange={(e) => setNationwide(e.target.checked)} label={t("nationwide")} />
        {!nationwide ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t("regions")}</legend>
              <div className="grid max-h-48 gap-1 overflow-y-auto">
                {regions.map((r) => (
                  <Checkbox key={r.value} name="regions[]" value={r.value} defaultChecked={zone?.regions.includes(r.value)} label={r.label} />
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t("cities")}</legend>
              <div className="grid max-h-48 gap-1 overflow-y-auto">
                {cities.map((r) => (
                  <Checkbox key={r.value} name="cities[]" value={r.value} defaultChecked={zone?.cities.includes(r.value)} label={r.label} />
                ))}
              </div>
            </fieldset>
          </div>
        ) : null}
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{t("rates")}</legend>
          {methods.map((m) => {
            const r = zone?.rates.find((x) => x.method === m);
            return (
              <div key={m} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
                <span className="text-sm sm:pb-2">{s(`methods.${m}`)}</span>
                <input type="hidden" name="method[]" value={m} />
                <Input name="fee[]" aria-label={`${t("fee")} — ${s(`methods.${m}`)}`} placeholder={t("fee")} defaultValue={r ? String(Number(r.fee)) : m === "standard" && !zone ? "0" : ""} inputMode="decimal" dir="ltr" />
                <Input name="freeOver[]" aria-label={`${t("freeOver")} — ${s(`methods.${m}`)}`} placeholder={t("freeOver")} defaultValue={r?.freeOver ? String(Number(r.freeOver)) : ""} inputMode="decimal" dir="ltr" />
                <Input name="etaMin[]" aria-label={`${t("etaMin")} — ${s(`methods.${m}`)}`} placeholder={t("etaMin")} defaultValue={String(r?.etaMinDays ?? 1)} inputMode="numeric" dir="ltr" />
                <Input name="etaMax[]" aria-label={`${t("etaMax")} — ${s(`methods.${m}`)}`} placeholder={t("etaMax")} defaultValue={String(r?.etaMaxDays ?? 5)} inputMode="numeric" dir="ltr" />
              </div>
            );
          })}
        </fieldset>
        {zone ? <Checkbox name="isActive" value="1" defaultChecked={zone.isActive} label={t("active")} /> : null}
        <SubmitButton>{c("save")}</SubmitButton>
      </ActionForm>
    </Modal>
  );
}

export function DeleteZoneButton({ id }: { id: string }) {
  const t = useTranslations("shipping");
  return (
    <ActionButton size="sm" variant="ghost" className="text-danger-600" confirm={`${t("delete")}?`} action={() => deleteZoneAction(id)}>
      {t("delete")}
    </ActionButton>
  );
}
