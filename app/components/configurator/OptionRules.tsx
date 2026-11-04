import { useEffect, useState } from "react";

import { fieldValue } from "~/components/polaris/helpers";
import { useT } from "~/i18n";
import type { EditorProduct } from "~/lib/configurator/editor-state";
import type {
  ConditionRule,
  Conditions,
  OptionGroup,
  PriceRule,
} from "~/lib/configurator/types";

/* Price changes and "show only when…" conditions for option groups and choices. */

const parseNum = (s: string) => {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};

/** A number field that keeps what the merchant is typing ("1." stays "1."). */
function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    if (parseNum(text) !== value) setText(value == null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <s-text-field
      label={label}
      value={text}
     
      onInput={(e) => {
        const v = fieldValue(e);
        setText(v);
        onChange(parseNum(v));
      }}
    />
  );
}

export function PriceEditor({
  price,
  onChange,
}: {
  price: PriceRule | undefined;
  onChange: (next: PriceRule | undefined) => void;
}) {
  const t = useT("editor");
  const p: PriceRule = price ?? { type: "none" };
  return (
    <s-stack direction="block" gap="small">
      <s-select
        label={t("optPricing")}
        value={p.type}
        onInput={(e) => {
          const type = fieldValue(e) as PriceRule["type"];
          onChange(type === "none" ? undefined : { ...p, type });
        }}
      >
        <s-option value="none">{t("priceNone")}</s-option>
        <s-option value="fixed">{t("priceFixed")}</s-option>
        <s-option value="percent">{t("pricePercent")}</s-option>
      </s-select>
      {p.type !== "none" ? (
        <>
          <NumField
            label={p.type === "percent" ? t("priceAmountPercent") : t("priceAmount")}
            value={p.amount}
            onChange={(amount) => onChange({ ...p, amount })}
          />
          <NumField
            label={t("priceSale")}
            value={p.sale}
            onChange={(sale) => onChange({ ...p, sale })}
          />
        </>
      ) : null}
    </s-stack>
  );
}

type Source = ConditionRule["source"];

export function ConditionsEditor({
  value,
  onChange,
  groups,
  selfGroupId,
  productOptions,
}: {
  value: Conditions | undefined;
  onChange: (next: Conditions | undefined) => void;
  groups: OptionGroup[];
  selfGroupId: string;
  productOptions: EditorProduct["options"];
}) {
  const t = useT("editor");
  const others = groups.filter((g) => g.id !== selfGroupId);
  const realOptions = productOptions.filter(
    (o) => !(o.name === "Title" && o.values.length === 1 && o.values[0] === "Default Title"),
  );
  const rules = value?.rules ?? [];
  const match = value?.match ?? "all";

  const commit = (nextRules: ConditionRule[], nextMatch = match) =>
    onChange(nextRules.length ? { match: nextMatch, rules: nextRules } : undefined);
  const patch = (i: number, rule: ConditionRule) =>
    commit(rules.map((r, j) => (j === i ? rule : r)));

  const blank = (source: Source): ConditionRule | null => {
    if (source === "option" && realOptions[0]) {
      return { source: "option", name: realOptions[0].name, op: "is", value: realOptions[0].values[0] ?? "" };
    }
    if (source === "group" && others[0]) {
      return { source: "group", groupId: others[0].id, op: "has_choice" };
    }
    return null;
  };
  const first = blank("option") ?? blank("group");

  return (
    <s-stack direction="block" gap="small">
      <p className="ed-sub">{t("condTitle")}</p>
      {rules.length === 0 ? <p className="ed-help">{t("condNone")}</p> : null}
      {rules.map((r, i) => {
        const switchSource = (s: Source) => {
          const next = blank(s);
          if (next) patch(i, next);
        };
        return (
          <div className="ed-cond" key={i}>
            <s-select label={t("condSource")} value={r.source} onInput={(e) => switchSource(fieldValue(e) as Source)}>
              {realOptions.length ? <s-option value="option">{t("condSourceOption")}</s-option> : null}
              {others.length ? <s-option value="group">{t("condSourceGroup")}</s-option> : null}
            </s-select>
            {r.source === "option" ? (
              <>
                <s-select
                  label={t("condOptionName")}
                  value={r.name}
                  onInput={(e) => {
                    const name = fieldValue(e);
                    patch(i, { ...r, name, value: realOptions.find((o) => o.name === name)?.values[0] ?? "" });
                  }}
                >
                  {realOptions.map((o) => (
                    <s-option key={o.name} value={o.name}>{o.name}</s-option>
                  ))}
                </s-select>
                <s-select label={t("condOperator")} value={r.op} onInput={(e) => patch(i, { ...r, op: fieldValue(e) as "is" | "is_not" })}>
                  <s-option value="is">{t("condIs")}</s-option>
                  <s-option value="is_not">{t("condIsNot")}</s-option>
                </s-select>
                <s-select label={t("condValue")} value={r.value} onInput={(e) => patch(i, { ...r, value: fieldValue(e) })}>
                  {(realOptions.find((o) => o.name === r.name)?.values ?? [r.value]).map((v) => (
                    <s-option key={v} value={v}>{v}</s-option>
                  ))}
                </s-select>
              </>
            ) : (
              <>
                <s-select
                  label={t("condGroup")}
                  value={r.groupId}
                  onInput={(e) => patch(i, { source: "group", groupId: fieldValue(e), op: r.op, choiceId: undefined })}
                >
                  {others.map((g) => (
                    <s-option key={g.id} value={g.id}>{g.label}</s-option>
                  ))}
                </s-select>
                <s-select
                  label={t("condOperator")}
                  value={r.op}
                  onInput={(e) => patch(i, { ...r, op: fieldValue(e) as typeof r.op })}
                >
                  <s-option value="is">{t("condIs")}</s-option>
                  <s-option value="is_not">{t("condIsNot")}</s-option>
                  <s-option value="has_choice">{t("condHasChoice")}</s-option>
                  <s-option value="no_choice">{t("condNoChoice")}</s-option>
                </s-select>
                {r.op === "is" || r.op === "is_not" ? (
                  <s-select
                    label={t("condChoice")}
                    value={r.choiceId ?? ""}
                    onInput={(e) => patch(i, { ...r, choiceId: fieldValue(e) || undefined })}
                  >
                    <s-option value="">{"—"}</s-option>
                    {(groups.find((g) => g.id === r.groupId)?.choices ?? []).map((c) => (
                      <s-option key={c.id} value={c.id}>{c.label}</s-option>
                    ))}
                  </s-select>
                ) : null}
              </>
            )}
            <s-button variant="tertiary" tone="critical" icon="delete" onClick={() => commit(rules.filter((_, j) => j !== i))}>
              {t("condRemove")}
            </s-button>
          </div>
        );
      })}
      {rules.length > 1 ? (
        <s-select label={t("condMatch")} value={match} onInput={(e) => commit(rules, fieldValue(e) as "all" | "any")}>
          <s-option value="all">{t("condMatchAll")}</s-option>
          <s-option value="any">{t("condMatchAny")}</s-option>
        </s-select>
      ) : null}
      {first ? (
        <s-button icon="plus" onClick={() => commit([...rules, first])}>
          {t("condAdd")}
        </s-button>
      ) : (
        <p className="ed-help">{t("condNothing")}</p>
      )}
    </s-stack>
  );
}
