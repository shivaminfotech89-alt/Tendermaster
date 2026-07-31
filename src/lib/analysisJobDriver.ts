// Drives a Tier-2 analysis_jobs doc to completion by repeatedly calling
// /api/process-analysis-job (one chunk per call — each request stays well
// under the Vercel maxDuration that motivated chunking in the first
// place). Has no component-state dependencies — extracted verbatim from
// TenderAnalyzer.tsx so ProjectDetails.tsx's re-analysis flow (Fix 2b) can
// drive a job the same way fresh analysis already does, without
// duplicating the loop. The job doc's own onSnapshot listener (owned by
// each caller) remains the source of truth for status/progress — this
// function only triggers server-side work and stops once the job reaches
// a terminal state; it never reads or returns the job's result itself.
import { fetchWithAuth } from "./api";

// A chunk stuck 'running' but not yet past the server's own stale-reclaim
// window isn't the job finishing — just nothing claimable RIGHT NOW.
// Waiting and retrying (bounded) avoids leaving the caller's progress UI
// dead with no way forward short of a manual reload.
const NO_MORE_CLAIMABLE_RETRY_DELAY_MS = 15_000;
const NO_MORE_CLAIMABLE_MAX_RETRIES = 16;

export async function driveAnalysisJob(jobId: string): Promise<void> {
  let noMoreClaimableStreak = 0;
  for (;;) {
    try {
      const res = await fetchWithAuth('/api/process-analysis-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const resText = await res.text();
      let resData: any = null;
      try { resData = JSON.parse(resText); } catch { /* onSnapshot still reflects real status */ }
      if (!res.ok) {
        console.error('[analysisJobDriver] process-analysis-job failed:', resData?.error);
        return; // the affected chunk's/job's failure state is written server-side; stop looping
      }
      if (
        resData?.jobStatus === 'blocked' ||
        resData?.jobStatus === 'done' ||
        resData?.jobStatus === 'failed' ||
        resData?.jobStatus === 'abandoned'
      ) {
        return;
      }
      if (resData?.noMoreClaimable) {
        noMoreClaimableStreak++;
        if (noMoreClaimableStreak > NO_MORE_CLAIMABLE_MAX_RETRIES) return;
        await new Promise(r => setTimeout(r, NO_MORE_CLAIMABLE_RETRY_DELAY_MS));
        continue;
      }
      noMoreClaimableStreak = 0;
      // Otherwise: one chunk was processed (or reclaimed) — loop for the next.
    } catch (e) {
      console.error('[analysisJobDriver] process-analysis-job request failed:', e);
      return; // caller can offer a manual resume/retry
    }
  }
}
