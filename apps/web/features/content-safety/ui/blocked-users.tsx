"use client";
import { blocksSchema } from "@/features/fan-posts/domain/content";
import { useFanpageResource } from "@/features/fanpage/ui/use-fanpage-resource";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import { useContentMutation } from "./use-content-mutation";
import styles from "./content.module.css";
const parse = (value: unknown) => blocksSchema.parse(value);
export function BlockedUsers({ locale }: { locale: AppLocale }) {
  const copy = contentCopy(locale), mutation = useContentMutation(locale), resource = useFanpageResource(`/api/content-blocks?locale=${toContentLocale(locale)}`, parse);
  async function remove(id: string) { if (await mutation.request(`/api/content-blocks/${id}`, "DELETE")) resource.retry(); }
  return <section className={styles.section}><h2>{copy.block}</h2>
    {resource.state.status === "ready" ? resource.state.data.items.length ? <ul className={styles.list}>{resource.state.data.items.map(user => <li key={user.id} className={`${styles.card} ${styles.row}`}>
      <span className={styles.meta}><img src={user.avatarUrl} alt="" width={32} height={32} /><strong>{user.nickname}</strong></span>
      <button className={styles.button} type="button" disabled={mutation.busy} aria-label={`${copy.unblock}: ${user.nickname}`} onClick={() => void remove(user.id)}>{copy.unblock}</button>
    </li>)}</ul> : <p className={styles.empty}>{copy.noBlocks}</p> : <p role="status">{resource.state.status === "loading" ? copy.loading : copy.failed}{resource.state.status === "error" && <button className={styles.button} onClick={resource.retry}>{copy.retry}</button>}</p>}
    {mutation.error && <p className={styles.error} role="alert">{mutation.error}</p>}
  </section>;
}
