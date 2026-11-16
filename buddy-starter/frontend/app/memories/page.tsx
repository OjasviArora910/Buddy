'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchApi, supabase } from '../../lib/supabase';

type Category = 'user_profile' | 'relationships' | 'life_events' | 'preferences' | 'open_threads';
type Memory = {
  id: string;
  content: string;
  category: Category;
  sensitive: boolean;
  source_reason: string;
  retention_days: number | null;
  expires_at: string | null;
};
const categories: { value: Category; label: string }[] = [
  { value: 'user_profile', label: 'User profile' },
  { value: 'relationships', label: 'Relationships' },
  { value: 'life_events', label: 'Life events' },
  { value: 'preferences', label: 'Preferences' },
  { value: 'open_threads', label: 'Open threads' },
];

export default function Memories() {
  const router = useRouter();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState<Category>('preferences');
  const [sensitive, setSensitive] = useState(false);
  const [retention, setRetention] = useState('90');
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editCategory, setEditCategory] = useState<Category>('preferences');
  const [editSensitive, setEditSensitive] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [automaticEnabled, setAutomaticEnabled] = useState(true);
  const [settingsBusy, setSettingsBusy] = useState(false);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const { data: { session } } = await supabase().auth.getSession();
    if (!session) {
      router.push('/login');
      throw new Error('Please sign in to manage memories.');
    }
    const response = await fetchApi(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...init.headers,
      },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Request failed.');
    return data;
  }, [router]);

  const refresh = useCallback(async () => {
    setError('');
    try {
      setMemories(await request('/memories'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load memories.');
    }
  }, [request]);

  useEffect(() => {
    void refresh();
    void request('/memory-settings').then((settings) => {
      setAutomaticEnabled(settings.automatic_enabled);
    }).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : 'Could not load memory settings.');
    });
  }, [refresh, request]);

  async function toggleAutomaticMemory(enabled: boolean) {
    setSettingsBusy(true);
    setError('');
    try {
      const settings = await request('/memory-settings', {
        method: 'PUT',
        body: JSON.stringify({ automatic_enabled: enabled }),
      });
      setAutomaticEnabled(settings.automatic_enabled);
      setNotice(enabled ? 'Automatic memory is enabled.' : 'Automatic memory is disabled.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update memory settings.');
    } finally {
      setSettingsBusy(false);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('/memories', {
        method: 'POST',
        body: JSON.stringify({
          content: draft.trim(),
          category,
          sensitive,
          consent: sensitive,
          retention_days: retention === 'never' ? null : Number(retention),
        }),
      });
      setDraft('');
      setSensitive(false);
      setNotice('Memory saved.');
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save this memory.');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(memory: Memory) {
    setEditing(memory.id);
    setEditDraft(memory.content);
    setEditCategory(memory.category);
    setEditSensitive(memory.sensitive);
    setError('');
    setNotice('');
  }

  async function saveEdit(memory: Memory) {
    if (!editDraft.trim() || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(`/memories/${memory.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          content: editDraft.trim(),
          category: editCategory,
          sensitive: editSensitive,
          consent: editSensitive,
        }),
      });
      setEditing(null);
      setNotice('Correction saved. Buddy will use the updated detail.');
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update this memory.');
    } finally {
      setBusy(false);
    }
  }

  async function changeRetention(memory: Memory, value: string) {
    setError('');
    try {
      await request(`/memories/${memory.id}/retention`, {
        method: 'PATCH',
        body: JSON.stringify({ retention_days: value === 'never' ? null : Number(value) }),
      });
      setNotice('Retention setting updated.');
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update retention.');
    }
  }

  async function remove(memory: Memory) {
    setError('');
    try {
      await request(`/memories/${memory.id}`, { method: 'DELETE' });
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setNotice('Memory permanently deleted.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not delete memory.');
    }
  }

  return (
    <main className="centerPage">
      <div className="memoryCard">
        <Link className="back" href="/chat?mode=account">← Back to chat</Link>
        <h1>What Buddy remembers</h1>
        <p>You choose what is saved, how long it stays, and what Buddy can use.</p>
        <div className="info">
          When enabled, Buddy can automatically save non-sensitive useful details from account conversations, avoid duplicates,
          and update facts you correct. Sensitive details are never saved without explicit consent. Saved details are sent to
          Gemini for replies and embeddings; avoid saving anything you do not want processed by that provider.
        </div>
        <label className="memoryToggle">
          <input
            type="checkbox"
            checked={automaticEnabled}
            disabled={settingsBusy}
            onChange={(event) => void toggleAutomaticMemory(event.target.checked)}
          />
          Enable automatic memory
        </label>
        <form onSubmit={add} className="memoryForm memoryAddForm">
          <input
            value={draft}
            maxLength={500}
            required
            onChange={(event) => setDraft(event.target.value)}
            placeholder="A detail you want Buddy to remember"
            aria-label="Memory detail"
          />
          <select value={category} onChange={(event) => setCategory(event.target.value as Category)} aria-label="Memory category">
            {categories.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
          </select>
          <select value={retention} onChange={(event) => setRetention(event.target.value)} aria-label="Memory retention">
            <option value="30">Delete after 30 days</option>
            <option value="90">Delete after 90 days</option>
            <option value="365">Delete after 1 year</option>
            <option value="never">Keep until I delete it</option>
          </select>
          <label className="consentLabel">
            <input type="checkbox" checked={sensitive} onChange={(event) => setSensitive(event.target.checked)} />
            This is sensitive; I explicitly consent to saving it
          </label>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save memory'}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="success" role="status">{notice}</p>}
        <div className="memoryList">
          {memories.length === 0 ? <p>No memories saved yet.</p> : memories.map((memory) => (
            <article className="memoryItem memoryItemCard" key={memory.id}>
              {editing === memory.id ? (
                <div className="memoryEdit">
                  <textarea value={editDraft} maxLength={500} onChange={(event) => setEditDraft(event.target.value)} aria-label="Correct memory" />
                  <select value={editCategory} onChange={(event) => setEditCategory(event.target.value as Category)} aria-label="Correction category">
                    {categories.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
                  </select>
                  <label className="consentLabel">
                    <input type="checkbox" checked={editSensitive} onChange={(event) => setEditSensitive(event.target.checked)} />
                    Sensitive; I explicitly consent to saving this
                  </label>
                  <div className="memoryActions">
                    <button type="button" onClick={() => void saveEdit(memory)} disabled={busy}>Save correction</button>
                    <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="memoryContent">
                    <span>{memory.content}</span>
                    <small>{categories.find((item) => item.value === memory.category)?.label}{memory.sensitive ? ' · Sensitive' : ''}</small>
                    <small>Why saved: {memory.source_reason}</small>
                  </div>
                  <label className="retentionLabel">
                    Keep
                    <select value={memory.retention_days === null ? 'never' : String(memory.retention_days)} onChange={(event) => void changeRetention(memory, event.target.value)} aria-label={`Retention for ${memory.content}`}>
                      <option value="30">30 days</option>
                      <option value="90">90 days</option>
                      <option value="365">1 year</option>
                      <option value="never">Until I delete it</option>
                    </select>
                  </label>
                  <div className="memoryActions">
                    <button type="button" onClick={() => startEdit(memory)}>Correct</button>
                    <button type="button" className="deleteMemory" onClick={() => void remove(memory)}>Delete</button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
