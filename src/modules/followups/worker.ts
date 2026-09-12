import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { sources, followupCases, followupVersions, interests, notifications, outbox } from '../../db/schema.js';
import type { ModuleContext } from '../../shared/types.js';
import type { JobHandlerRegistry } from '../../jobs/types.js';
import { withJobFence } from '../../jobs/transaction.js';
import { isPubliclyVisible } from '../sources/access.js';

export function registerFollowupJobs(ctx: ModuleContext, registry: JobHandlerRegistry) {
  registry.register('followup.notify', async job => {
    const p = z.object({ source_id: z.string().uuid(), case_id: z.string().uuid(), version_id: z.string().uuid() }).parse(job.payload);
    await ctx.db.transaction(async tx => {
      const [source] = await tx.select().from(sources).where(eq(sources.id, p.source_id)).for('update');
      await withJobFence(tx, { jobId: job.job.id, fencingToken: job.job.fencingToken }, async fenced => {
        const [event] = await fenced.select().from(outbox).where(and(eq(outbox.topic, 'followup.published'), eq(outbox.dedupeKey, p.version_id))).for('update');
        if (!event || ['sent', 'cancelled'].includes(event.status)) return;
        const [caseRow] = await fenced.select().from(followupCases).where(eq(followupCases.id, p.case_id));
        const [version] = await fenced.select().from(followupVersions).where(eq(followupVersions.id, p.version_id));
        if (!source || !await isPubliclyVisible(fenced, source) || caseRow?.publishedVersionId !== p.version_id || version?.status !== 'published') {
          await fenced.update(outbox).set({ status: 'cancelled', recipients: [], processedAt: ctx.now() }).where(eq(outbox.id, event.id));
          return;
        }
        const recipients = z.array(z.object({ readerKey: z.string(), cohort: z.string() })).parse(event.recipients);
        for (const recipient of recipients) {
          // Recheck at delivery, with the interest row locked against cancellation.
          const [interest] = await fenced.select().from(interests).where(and(eq(interests.sourceId, source.id), eq(interests.readerKey, recipient.readerKey))).for('update');
          if (!interest?.active || recipient.readerKey === caseRow.authorUserId) continue;
          await fenced.insert(notifications).values({ readerKey: recipient.readerKey, caseId: p.case_id, followupVersionId: p.version_id }).onConflictDoNothing();
        }
        await fenced.update(outbox).set({ status: 'sent', processedAt: ctx.now(), recipients: [], attempts: event.attempts + 1, updatedAt: ctx.now() }).where(eq(outbox.id, event.id));
      });
    });
    return { data: { processed: true } };
  });
}
