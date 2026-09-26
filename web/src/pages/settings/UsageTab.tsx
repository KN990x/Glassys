import { useT } from "../../i18n";
import { formatTokens } from "../../format";
import { EmptyRow, SettingGroup } from "../../components/Primitives";
import { IconChart } from "../../components/Icon";

export function UsageTab({
  usage,
  threadUsage,
  locale,
}: {
  usage: {
    inputTokens: number;
    outputTokens: number;
    byAdapter: Record<string, { inputTokens: number; outputTokens: number }>;
  } | null;
  threadUsage: { inputTokens: number; outputTokens: number } | null;
  locale: string;
}) {
  const t = useT();
  if (!usage && !threadUsage) {
    return (
      <SettingGroup>
        <EmptyRow glyph={<IconChart />}>{t("settings.usageEmpty")}</EmptyRow>
      </SettingGroup>
    );
  }
  const rows: Array<{ key: string; label: string; input: number; output: number }> = [];
  if (threadUsage) {
    rows.push({ key: "thread", label: t("settings.usageThread"), input: threadUsage.inputTokens, output: threadUsage.outputTokens });
  }
  if (usage) {
    rows.push({ key: "all", label: t("settings.usageAll"), input: usage.inputTokens, output: usage.outputTokens });
    for (const [id, total] of Object.entries(usage.byAdapter)) {
      rows.push({ key: `adapter:${id}`, label: id, input: total.inputTokens, output: total.outputTokens });
    }
  }
  /* The columns were headed "↓" and "↑", which needed a legend nobody had. */
  return (
    <table className="usage-table">
      <thead>
        <tr>
          <th scope="col">{t("settings.usage")}</th>
          <th scope="col">{t("settings.usageInput")}</th>
          <th scope="col">{t("settings.usageOutput")}</th>
          <th scope="col">{t("settings.usageTotal")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.label}</th>
            <td className="nums">{formatTokens(row.input, locale)}</td>
            <td className="nums">{formatTokens(row.output, locale)}</td>
            <td className="nums">{formatTokens(row.input + row.output, locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
