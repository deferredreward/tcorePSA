// loadChecks threads each tool's resource pin to its Door43 fetch, so a
// project checked against a non-English GL loads its tN AND tW checks from the
// pinned release (matching the checkIds its decisions were keyed against).
import { describe, it, expect, vi } from 'vitest';

const fetchTnTsv = vi.fn(async () =>
  'Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote\n' +
  '1:1\tab12\t\trc://*/ta/man/translate/figs-metaphor\tδοῦλος\t1\tA note\n');
const fetchTwlTsv = vi.fn(async () =>
  'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink\n' +
  '1:1\tcd34\t\tΘεοῦ\t1\trc://*/tw/dict/bible/kt/god\n');

vi.mock('./door43', () => ({ fetchTnTsv, fetchTwlTsv }));

const { loadChecks } = await import('./sync');

const project = {
  bookCode: 'TIT',
  chapters: { 1: { 1: 'Paul, a servant of God…' } },
};

describe('loadChecks pin threading', () => {
  it('passes each tool its own pin to the matching Door43 fetch', async () => {
    const pins = {
      translationNotes: { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v88' },
      translationWords: { repoPath: 'git.door43.org/Door43-Catalog/es-419_tw', version: 'v10' },
    };

    const { tn, tw } = await loadChecks(project, pins);

    expect(fetchTnTsv).toHaveBeenCalledWith('TIT', pins.translationNotes);
    expect(fetchTwlTsv).toHaveBeenCalledWith('TIT', pins.translationWords);
    expect(tn).toHaveLength(1);
    expect(tw).toHaveLength(1);
  });
});
