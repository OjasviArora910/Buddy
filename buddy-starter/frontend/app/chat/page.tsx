'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowUp, Heart, Mic, Square, LogOut, Brain, ShieldCheck } from 'lucide-react';
import { fetchApi, supabase } from '../../lib/supabase';
import styles from './chat-controls.module.css';

type Msg = { id?: string; role: 'user' | 'assistant'; content: string; created_at?: string };
type Conversation = { id: string; title: string; updated_at: string };
type Category = 'user_profile' | 'relationships' | 'life_events' | 'preferences' | 'open_threads';
type MemorySuggestion = {
  content: string;
  category: Category;
  sensitive: boolean;
  replaces_memory_id: string | null;
  replaces_memory_content: string | null;
  requires_consent: boolean;
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
const categoryLabels: Record<Category, string> = {
  user_profile: 'Profile',
  relationships: 'Relationships',
  life_events: 'Life event',
  preferences: 'Preferences',
  open_threads: 'Open thread',
};

function ChatInner() {
  const params = useSearchParams();
  const router = useRouter();
  const mode = params.get('mode') === 'account' ? 'account' : 'quick';
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingSuggestion, setSavingSuggestion] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [memoryNotice, setMemoryNotice] = useState('');
  const [persistenceNotice, setPersistenceNotice] = useState('');
  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>([]);
  const [ready, setReady] = useState(mode === 'quick');
  const [recording, setRecording] = useState(false);
  const [safety, setSafety] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    let active = true;
    if (mode === 'account') {
      (async () => {
        try {
          const { data: { session } } = await supabase().auth.getSession();
          if (!session) {
            router.replace('/login');
            return;
          }
          const response = await fetchApi('/conversations', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (!response.ok) throw new Error('Could not load conversations. Check that the database migration has been run.');
          const savedConversations: Conversation[] = await response.json();
          let selected = savedConversations[0];
          if (!selected) {
            const created = await fetchApi('/conversations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ title: 'New conversation' }),
            });
            if (!created.ok) throw new Error('Could not start an account conversation.');
            selected = await created.json();
            savedConversations.unshift(selected);
          }
          const historyResponse = await fetchApi(`/conversations/${selected.id}/messages?limit=40`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (!historyResponse.ok) throw new Error('Could not open this conversation.');
          const history: Msg[] = await historyResponse.json();
          if (active) {
            setConversations(savedConversations);
            setConversationId(selected.id);
            setMessages(history);
            setHasOlderMessages(history.length === 40);
          }
        } catch (requestError) {
          if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load account.');
        } finally {
          if (active) setReady(true);
        }
      })();
    }
    return () => { active = false; };
  }, [mode, router]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy, suggestions]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    setError('');
    setMemoryNotice('');
    setPersistenceNotice('');
    setSuggestions([]);
    try {
      let token = '';
      if (mode === 'account') {
        const { data: { session } } = await supabase().auth.getSession();
        if (!session) {
          router.push('/login');
          return;
        }
        token = session.access_token;
      }
      const response = await fetchApi('/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mode, message: text, ...(mode === 'account' ? { conversation_id: conversationId } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || 'Could not send message.');
      const updatedMessages = [...next, { role: 'assistant' as const, content: body.reply }];
      setMessages(updatedMessages);
      if (mode === 'account' && messages.length === 0) {
        setConversations((current) => current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, title: text.slice(0, 60), updated_at: new Date().toISOString() }
            : conversation,
        ));
      }
      setSafety(Boolean(body.safety_notice));
      setMemoryNotice(body.memory_notice || '');
      setPersistenceNotice(body.persistence_notice || '');
      setSuggestions(body.memory_suggestions || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Something went wrong.');
      setDraft(text);
      setMessages(messages);
    } finally {
      setBusy(false);
    }
  }

  async function selectConversation(id: string) {
      if (busy || id === conversationId) return;
      setError('');
      try {
        const { data: { session } } = await supabase().auth.getSession();
        if (!session) { router.push('/login'); return; }
        const response = await fetchApi(`/conversations/${id}/messages?limit=40`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!response.ok) throw new Error('Could not open this conversation.');
        const history: Msg[] = await response.json();
        setConversationId(id);
        setMessages(history);
        setHasOlderMessages(history.length === 40);
        setSuggestions([]);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Could not open conversation.');
      }
  }

  async function createConversation() {
      setError('');
      try {
        const { data: { session } } = await supabase().auth.getSession();
        if (!session) { router.push('/login'); return; }
        const response = await fetchApi('/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ title: 'New conversation' }),
        });
        if (!response.ok) throw new Error('Could not create a conversation.');
        const conversation: Conversation = await response.json();
        setConversations((current) => [conversation, ...current]);
        setConversationId(conversation.id);
        setMessages([]);
        setSuggestions([]);
        setHasOlderMessages(false);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Could not create conversation.');
      }
  }

  async function renameConversation() {
      const conversation = conversations.find((item) => item.id === conversationId);
      if (!conversation) return;
      const title = window.prompt('Conversation name', conversation.title)?.trim();
      if (!title || title === conversation.title) return;
      try {
        const { data: { session } } = await supabase().auth.getSession();
        if (!session) { router.push('/login'); return; }
        const response = await fetchApi(`/conversations/${conversationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ title }),
        });
        if (!response.ok) throw new Error('Could not rename this conversation.');
        const updated: Conversation = await response.json();
        setConversations((current) => current.map((item) => item.id === updated.id ? updated : item));
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Could not rename conversation.');
      }
  }

  async function deleteConversation() {
      if (!conversationId || !window.confirm('Delete this conversation and all of its messages?')) return;
      try {
        const { data: { session } } = await supabase().auth.getSession();
        if (!session) { router.push('/login'); return; }
        const response = await fetchApi(`/conversations/${conversationId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!response.ok) throw new Error('Could not delete this conversation.');
        const remaining = conversations.filter((item) => item.id !== conversationId);
        setConversations(remaining);
        setConversationId('');
        setMessages([]);
        if (remaining[0]) await selectConversation(remaining[0].id);
        else await createConversation();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Could not delete conversation.');
      }
  }

  async function loadOlderMessages() {
      if (!conversationId || !messages[0]?.created_at || loadingOlder) return;
      setLoadingOlder(true);
      try {
        const { data: { session } } = await supabase().auth.getSession();
        if (!session) { router.push('/login'); return; }
        const before = encodeURIComponent(messages[0].created_at);
        const response = await fetchApi(`/conversations/${conversationId}/messages?limit=40&before=${before}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!response.ok) throw new Error('Could not load older messages.');
        const older: Msg[] = await response.json();
        setMessages((current) => [...older, ...current]);
        setHasOlderMessages(older.length === 40);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Could not load older messages.');
      } finally {
        setLoadingOlder(false);
    }
  }

  async function saveSuggestion(suggestion: MemorySuggestion, index: number) {
    if (savingSuggestion !== null) return;
    setSavingSuggestion(index);
    setError('');
    try {
      const { data: { session } } = await supabase().auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
      const response = await fetchApi('/memories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          content: suggestion.content,
          category: suggestion.category,
          sensitive: suggestion.requires_consent || suggestion.sensitive,
          consent: suggestion.requires_consent || suggestion.sensitive,
          retention_days: 90,
          replaces_memory_id: suggestion.replaces_memory_id,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || 'Could not save this memory.');
      setSuggestions((current) => current.filter((_, itemIndex) => itemIndex !== index));
      setMemoryNotice(suggestion.replaces_memory_id ? 'Memory corrected and updated.' : 'Memory saved for 90 days.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save this memory.');
    } finally {
      setSavingSuggestion(null);
    }
  }

  function mic() {
    if (recording) {
      recognition.current?.stop();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Constructor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Constructor) {
      setError('Voice input is not available in this browser. You can type instead.');
      return;
    }
    const rec = new Constructor();
    recognition.current = rec;
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.onresult = (event) => setDraft((value) => (value + ' ' + event.results[0][0].transcript).trim());
    rec.onerror = (event) => setError('Microphone: ' + event.error);
    rec.onend = () => setRecording(false);
    try {
      rec.start();
      setRecording(true);
    } catch {
      setError('Could not start microphone.');
    }
  }

  async function logout() {
    await supabase().auth.signOut();
    router.push('/');
  }

  function dismissSuggestion(index: number) {
    setSuggestions((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <main className="chatShell">
      <aside className="sidebar">
        <Link className="brand" href="/"><span className="brandmark"><Heart size={19} /></span> buddy<span className="branddot">.</span></Link>
        <div className="sideMenu">
          {mode === 'account' ? (
            <>
              <button type="button" className={styles.newConversation} onClick={() => void createConversation()}>+ New conversation</button>
              <div className={styles.conversationList}>
                {conversations.map((conversation) => (
                  <button
                    type="button"
                    key={conversation.id}
                    className={`${styles.conversationLink} ${conversation.id === conversationId ? styles.selected : ''}`}
                    onClick={() => void selectConversation(conversation.id)}
                    title={conversation.title}
                  >
                    {conversation.title}
                  </button>
                ))}
              </div>
            </>
          ) : <div className="sideActive">Conversation</div>}
          {mode === 'account' && <Link href="/memories"><Brain size={17} /> What Buddy remembers</Link>}
        </div>
        <div className="sideBottom">
          <span><ShieldCheck size={16} /> AI companion · Internal test</span>
          {mode === 'account'
            ? <button onClick={logout}><LogOut size={16} /> Sign out</button>
            : <Link href="/login">Get your own Buddy →</Link>}
        </div>
      </aside>
      <section className="chatMain">
        <header className="chatHeader">
          <div className="mobileBrand">buddy<span className="branddot">.</span></div>
          <div className="chatTitle">
            <strong>Buddy</strong>
            <span>{mode === 'quick' ? 'Quick chat · Not saved' : 'Your Buddy · Account memory'}</span>
          </div>
          <div className="headerLinks">
            {mode === 'account' && (
              <>
                <button className={styles.headerAction} type="button" onClick={() => void renameConversation()}>Rename</button>
                <button className={styles.headerAction} type="button" onClick={() => void deleteConversation()}>Delete</button>
                <Link href="/memories">Memories</Link>
              </>
            )}
            <Link href="/">Home</Link>
          </div>
        </header>
        {mode === 'account' && (
          <div className={styles.mobileConversationControls}>
            <select
              value={conversationId}
              onChange={(event) => void selectConversation(event.target.value)}
              aria-label="Select conversation"
            >
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>{conversation.title}</option>
              ))}
            </select>
            <button type="button" onClick={() => void createConversation()}>+ New</button>
          </div>
        )}
        <div className="messageArea">
          <div className="conversation">
            {mode === 'account' && hasOlderMessages && (
              <button type="button" className={styles.loadOlder} disabled={loadingOlder} onClick={() => void loadOlderMessages()}>
                {loadingOlder ? 'Loading…' : 'Load older messages'}
              </button>
            )}
            {messages.length === 0 && (
              <div className="welcome">
                <div className="welcomeIcon"><Heart size={28} /></div>
                <h1>Hey, I&apos;m Buddy.</h1>
                <p>I&apos;m here to listen. What&apos;s on your mind today?</p>
                <span>I&apos;m an AI companion, not a therapist.</span>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index} className={'bubble ' + (message.role === 'user' ? 'mine' : 'theirs')}>{message.content}</div>
            ))}
            {busy && <div className="bubble theirs typing">Buddy is thinking…</div>}
            {safety && <div className="safety">If you&apos;re in immediate danger, contact local emergency services or a trusted person. In India: 112 · Tele-MANAS: 14416. Numbers must be verified before a public launch.</div>}
            {suggestions.map((suggestion, index) => (
              <section className="memorySuggestion" key={`${suggestion.content}-${index}`} aria-label="Memory suggestion">
                <strong>{suggestion.replaces_memory_id ? 'Update an existing memory?' : 'Remember this?'}</strong>
                <p>{suggestion.content}</p>
                <small>{categoryLabels[suggestion.category]}{suggestion.sensitive ? ' · Sensitive detail' : ''}</small>
                {suggestion.replaces_memory_content && (
                  <p className="oldMemory">Currently: {suggestion.replaces_memory_content}</p>
                )}
                {suggestion.requires_consent && (
                  <p className="consentNotice">This may be sensitive. Choose the consent button only if you explicitly agree to save it.</p>
                )}
                <div className="memoryActions">
                  <button type="button" disabled={savingSuggestion !== null} onClick={() => void saveSuggestion(suggestion, index)}>
                    {savingSuggestion === index
                      ? 'Saving…'
                      : suggestion.requires_consent
                        ? 'I consent — save for 90 days'
                        : suggestion.replaces_memory_id
                          ? 'Replace old detail'
                          : 'Save for 90 days'}
                  </button>
                  <button type="button" disabled={savingSuggestion !== null} onClick={() => dismissSuggestion(index)}>Don&apos;t save</button>
                </div>
              </section>
            ))}
            <div ref={bottom} />
          </div>
        </div>
        <div className="composerArea">
          {error && <div className="error chatError" role="alert">{error}</div>}
          {persistenceNotice && <div className="error chatError" role="alert">{persistenceNotice}</div>}
          {memoryNotice && <div className="memoryNotice" role="status">{memoryNotice}</div>}
          <form className="composer" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send(); }}>
            <button type="button" className={'mic ' + (recording ? 'active' : '')} onClick={mic} aria-label={recording ? 'Stop voice input' : 'Start voice input'}>
              {recording ? <Square size={19} /> : <Mic size={19} />}
            </button>
            <input
              aria-label="Your message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Message Buddy…"
              maxLength={5000}
              disabled={!ready || busy}
            />
            <button className="send" type="submit" disabled={!draft.trim() || busy || !ready} aria-label="Send message"><ArrowUp size={20} /></button>
          </form>
          <div className="composerFoot">Buddy can make mistakes. For emergencies, contact local services.</div>
        </div>
      </section>
    </main>
  );
}

export default function Chat() {
  return <Suspense fallback={<div className="centerPage">Loading Buddy…</div>}><ChatInner /></Suspense>;
}
