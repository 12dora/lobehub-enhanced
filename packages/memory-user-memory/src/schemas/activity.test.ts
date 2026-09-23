import { describe, expect, it } from 'vitest';

import { ActivityMemoryItemSchema, coerceActivityMemoryInput } from './activity';

describe('ActivityMemoryItemSchema', () => {
  it('accepts nullable activity metadata from generated schema output', () => {
    const result = ActivityMemoryItemSchema.safeParse({
      details: 'The user completed a planned activity.',
      memoryCategory: 'work',
      memoryType: 'activity',
      summary: 'The user completed an activity.',
      tags: ['activity'],
      title: 'Completed an activity',
      withActivity: {
        associatedLocations: null,
        associatedObjects: null,
        associatedSubjects: null,
        endsAt: null,
        feedback: null,
        metadata: null,
        narrative: 'The activity was completed.',
        notes: null,
        startsAt: null,
        status: 'completed',
        tags: ['activity'],
        timezone: null,
        type: 'work',
      },
    });

    expect(result.success).toBe(true);
  });

  it('parses a stringified withActivity and maps document objects to knowledge', () => {
    const coerced = coerceActivityMemoryInput({
      details: '初稿已完成',
      memoryCategory: 'work',
      memoryType: 'activity',
      summary: '初稿已完成',
      tags: ['doc'],
      title: '初稿',
      withActivity: JSON.stringify({
        associatedObjects: [{ extra: null, name: '项目管理办法', type: 'document' }],
        narrative: '完成了初稿',
      }),
    });

    const result = ActivityMemoryItemSchema.safeParse(coerced);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.withActivity.associatedObjects).toEqual([
      { extra: null, name: '项目管理办法', type: 'knowledge' },
    ]);
  });
});
