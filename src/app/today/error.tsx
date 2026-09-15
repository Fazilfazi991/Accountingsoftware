"use client";
import Link from "next/link";
import styles from "@/components/today/today.module.css";

export default function Error({ reset }: { reset: () => void }) {
  return <main className={styles.page}><div className={styles.panel} role="alert"><h1>Today is temporarily unavailable</h1>
    <p>We couldn’t load your financial view. Your accounting records have not changed.</p>
    <button className={styles.button} onClick={reset}>Try again</button> <Link href="/">Return to Dashboard</Link>
  </div></main>;
}
