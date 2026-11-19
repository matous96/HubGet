/**
 * Průběh operace na ikoně HubGetu v hlavním panelu Windows (jako při kopírování
 * souborů): stejné jedno procento jako karta (hooks/useJobPercent), žlutě když se
 * čeká na uživatele (UAC, průvodce, uložení práce), běžící pruh u neurčitého průběhu.
 * Vidět i s minimalizovaným oknem.
 */
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { useJobPercent } from "@/hooks/useJobPercent";
import { isTauri } from "@/lib/tauri";
import { useJobs } from "@/store/jobs";
import type { Job } from "@/types";

const setProgress = (status: ProgressBarStatus, progress?: number) =>
  getCurrentWindow()
    .setProgressBar({ status, progress })
    .catch(() => undefined);

export function TaskbarProgress() {
  // Běžící úloha (ostatní čekají ve frontě), jinak první čekající
  const job = useJobs((s) => {
    const jobs = Object.values(s.jobs);
    return jobs.find((j) => j.progress.phase !== "queued") ?? jobs[0];
  });
  if (!isTauri()) return null;
  return job ? <TaskbarJob key={job.id} job={job} /> : <TaskbarIdle />;
}

function TaskbarJob({ job }: { job: Job }) {
  const { percent, needsUser } = useJobPercent(job);
  useEffect(() => {
    if (needsUser) void setProgress(ProgressBarStatus.Paused, percent ?? 100);
    else if (percent === null) void setProgress(ProgressBarStatus.Indeterminate);
    else void setProgress(ProgressBarStatus.Normal, percent);
  }, [percent, needsUser]);
  return null;
}

function TaskbarIdle() {
  useEffect(() => {
    void setProgress(ProgressBarStatus.None);
  }, []);
  return null;
}
