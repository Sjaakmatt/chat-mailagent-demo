import { describe, it, expect, vi } from 'vitest';
import { executeApproved } from './index.js';
import type { ReviewItem } from '../contracts/index.js';

function approvedItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: 'ri-1',
    organizationId: 'org-demo',
    signalId: 'sig-1',
    kind: 'draft_email',
    summary: 'Antwoord op order-status',
    proposed: { subject: 'Re', body: 'Je pakket is onderweg.' },
    confidence: 0.9,
    grounding: null,
    status: 'APPROVED',
    createdAt: '2026-06-23T10:00:00.000Z',
    ...overrides,
  };
}

describe('executeApproved', () => {
  it('voert de side effect uit en levert EXECUTED + MemoryEntry', async () => {
    const performAction = vi.fn().mockResolvedValue({ ref: 'msg-99' });
    const res = await executeApproved(approvedItem(), 'key-1', {
      performAction,
      now: () => '2026-06-23T10:05:00.000Z',
      newId: () => 'mem-1',
    });

    expect(performAction).toHaveBeenCalledOnce();
    expect(res.skipped).toBe(false);
    expect(res.reviewItem.status).toBe('EXECUTED');
    expect(res.reviewItem.executedAt).toBe('2026-06-23T10:05:00.000Z');
    expect(res.memoryEntry).toMatchObject({
      organizationId: 'org-demo',
      scope: 'CLIENT',
      sourceRef: 'msg-99',
      source: 'reviewitem:ri-1',
    });
  });

  it('is idempotent: bij een al uitgevoerde key geen tweede side effect', async () => {
    const performAction = vi.fn().mockResolvedValue({ ref: 'msg-99' });
    const res = await executeApproved(approvedItem(), 'key-1', {
      performAction,
      isAlreadyExecuted: async () => true,
    });

    expect(performAction).not.toHaveBeenCalled();
    expect(res.skipped).toBe(true);
    expect(res.reviewItem.status).toBe('EXECUTED');
  });

  it('weigert een niet-goedgekeurd ReviewItem', async () => {
    await expect(
      executeApproved(approvedItem({ status: 'PENDING' }), 'key-1', {
        performAction: vi.fn(),
      }),
    ).rejects.toThrow(/APPROVED\/EDITED/);
  });

  it('schrijft geen MemoryEntry als writeMemory false is', async () => {
    const res = await executeApproved(approvedItem(), 'key-1', {
      performAction: async () => ({}),
      writeMemory: false,
    });
    expect(res.memoryEntry).toBeUndefined();
  });
});
