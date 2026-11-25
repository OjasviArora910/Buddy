'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchApi } from '../../lib/api';
import { authClient } from '../../lib/auth';
import { ProtectedRoute } from '../../components/auth/ProtectedRoute';

type Category = 'user_profile' | 'relationships' | 'life_events' | 'preferences' | 'open_threads';
type Memory = {
  id: string;
  content: string;
  category: Category;
  sensitive: boolean;
  status: 'active' | 'resolved';
  resolved_at: string | null;
  last_checkin_at: string | null;
  source?: 'learned_from_chat' | 'manual';
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

function MemoriesContent() {
  const router = useRouter();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editCategory, setEditCategory] = useState<Category>('preferences');
  const [editSensitive, setEditSensitive] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [automaticEnabled, setAutomaticEnabled] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const { data: { session } } = await authClient().auth.getSession();
    if (!session) {
      router.push('/login');
      throw new Error('Please sign in to manage memories.');
    }
    const method = (init.method || 'GET').toUpperCase();
    const operation = path === '/memory-settings'
      ? `memory.settings.${method.toLowerCase()}`
      : path === '/memories'
        ? (method === 'DELETE' ? 'memory.delete_all' : 'memory.load')
        : method === 'PATCH' ? 'memory.retention'
          : method === 'DELETE' ? 'memory.delete'
            : method === 'PUT' ? 'memory.update' : 'memory.action';
    const response = await fetchApi(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...init.headers,
      },
    }, operation);
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
    if (!window.confirm('Delete this saved fact from Buddy’s memory? Your conversation messages will remain.')) return;
    setError('');
    try {
      await request(`/memories/${memory.id}`, { method: 'DELETE' });
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setNotice('Memory permanently deleted.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not delete memory.');
    }
  }

  async function removeAll() {
    if (!memories.length || !window.confirm('Permanently delete all saved facts? Conversation messages will remain.')) return;
    setError('');
    try {
      await request('/memories', { method: 'DELETE' });
      setMemories([]);
      setNotice('All saved memories were permanently deleted.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not delete saved memories.');
    }
  }

  return (
    <main className="centerPage">
      <div className="memoryCard">
        <Link className="back" href="/chat?mode=account">← Back to chat</Link>
        <h1>What Buddy remembers</h1>
        <p>Review details Buddy learned from your chats, correct anything, or remove it.</p>
        <button type="button" className="deleteMemory" disabled={!memories.length || busy} onClick={() => void removeAll()}>
          Delete all saved facts
        </button>
        <div className="info">When enabled, Buddy can learn useful details from your account chats and use relevant saved facts or older chat excerpts in a new reply. Turning it off stops saving and both kinds of recall. Sensitive details are excluded. Deleting a saved fact also blocks recall from its source chat.</div>
        <label className="memoryToggle">
          <input
            type="checkbox"
            checked={automaticEnabled}
            disabled={settingsBusy}
            onChange={(event) => void toggleAutomaticMemory(event.target.checked)}
          />
          Enable learning, saved-memory recall, and relevant past-chat context
        </label>
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
                    <small>{memory.source === 'learned_from_chat' ? 'Learned from chat' : 'Added by you'} · {categories.find((item) => item.value === memory.category)?.label}{memory.sensitive ? ' · Sensitive' : ''} · {memory.status === 'resolved' ? 'Resolved' : 'Active'}</small>
                    <small>Why saved: {memory.source_reason}</small>
                    {memory.last_checkin_at && <small>Last check-in: {new Date(memory.last_checkin_at).toLocaleDateString()}</small>}
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

export default function Memories() {
  return <ProtectedRoute><MemoriesContent /></ProtectedRoute>;
}
