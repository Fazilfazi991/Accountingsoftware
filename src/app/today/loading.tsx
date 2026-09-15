import styles from "@/components/today/today.module.css";

export default function Loading() {
  return <main className={styles.page} aria-label="Loading Today">
    <div className={styles.skeleton} style={{ width: "55%", height: 32 }} />
    <div className={styles.skeleton} style={{ width: "80%", height: 18 }} />
    <div className={styles.moneyGrid}>{[1, 2, 3].map((id) => <div className={styles.skeletonCard} key={id} />)}</div>
    <div className={styles.contentGrid}>{[1, 2, 3, 4].map((id) => <div className={styles.skeletonCard} key={id} />)}</div>
  </main>;
}
