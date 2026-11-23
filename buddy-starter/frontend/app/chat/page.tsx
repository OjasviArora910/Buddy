'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowUp, Heart, Mic, Square, LogOut, Brain, ShieldCheck } from 'lucide-react';
import { fetchApi } from '../../lib/api';
import { authClient } from '../../lib/auth';
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
  const requestedConversationId = mode === 'account' ? (params.get('conversation_id') || '') : '';
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [loadedConversationId, setLoadedConversationId] = useState('');
  const [loadedMode, setLoadedMode] = useState<'account' | 'quick'>('quick');
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
  const creatingConversation = useRef(false);
  const activeConversation = useRef('');
  const bottom = useRef<HTMLDivElement>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const currentConversation = conversations.find((item) => item.id === (requestedConversationId || conversationId));
  const openingRequestedConversation = mode === 'account' && (!ready || loadedConversationId !== requestedConversationId);
  const visibleMessages = mode !== loadedMode || openingRequestedConversation ? [] : messages;

  useEffect(() => {
    let active = true;
    activeConversation.current = requestedConversationId;
    if (mode !== 'account') {
      setConversations([]);
      setConversationId('');
      setLoadedConversationId('');
      setMessages([]);
      setSuggestions([]);
      setLoadedMode('quick');
      setReady(true);
      return () => { active = false; };
    }
    setReady(false);
    setError('');
    setMessages([]);
    setSuggestions([]);
    setHasOlderMessages(false);
    (async () => {
      try {
        const { data: { session } } = await authClient().auth.getSession();
        if (!session) { router.replace('/login'); return; }
        const headers = { Authorization: `Bearer ${session.access_token}` };
        const listResponse = await fetchApi('/conversations', { headers });
        if (!listResponse.ok) throw new Error('Could not load your conversations. Please refresh and try again.');
        const savedConversations: Conversation[] = await listResponse.json();
        if (!active) return;
        setConversations(savedConversations);
        const selectedId = requestedConversationId || savedConversations[0]?.id || '';
        if (!selectedId) {
          setConversationId('');
          setMessages([]);
          setLoadedConversationId('');
          setLoadedMode('account');
          setReady(true);
          return;
        }
        if (!requestedConversationId) {
          router.replace(`/chat?mode=account&conversation_id=${encodeURIComponent(selectedId)}`);
        }
        const historyResponse = await fetchApi(`/conversations/${selectedId}/messages?limit=40`, { headers });
        if (!historyResponse.ok) {
          const details = await historyResponse.json().catch(() => ({}));
          const statusText = historyResponse.status === 404
            ? 'This conversation was deleted or no longer exists.'
            : historyResponse.status === 403
              ? 'You do not have access to this conversation.'
              : details.detail || 'Could not open this conversation. Please try again.';
          throw new Error(statusText);
        }
        const history: Msg[] = await historyResponse.json();
        if (active && activeConversation.current === selectedId) {
          setConversationId(selectedId);
          setLoadedConversationId(selectedId);
          setLoadedMode('account');
          setMessages(history);
          setHasOlderMessages(history.length === 40);
        }
      } catch (requestError) {
        if (active) {
          setConversationId('');
          setLoadedConversationId(requestedConversationId);
          setLoadedMode('account');
          setMessages([]);
          setError(requestError instanceof Error ? requestError.message : 'Could not open this conversation.');
        }
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => { active = false; };
  }, [mode, requestedConversationId, router]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy, suggestions]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    let targetConversationId = conversationId;
    if (mode === 'account' && !targetConversationId) {
      const created = await createConversation();
      if (!created) { setBusy(false); return; }
      targetConversationId = created.id;
    }
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    if (mode !== 'account' || activeConversation.current === targetConversationId) setMessages(next);
    setDraft('');
    setError('');
    setMemoryNotice('');
    setPersistenceNotice('');
    setSuggestions([]);
    try {
      let token = '';
      if (mode === 'account') {
        const { data: { session } } = await authClient().auth.getSession();
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
        body: JSON.stringify({ mode, message: text, ...(mode === 'account' ? { conversation_id: targetConversationId, request_id: crypto.randomUUID() } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || 'Could not send message.');
      const updatedMessages = [...next, { role: 'assistant' as const, content: body.reply }];
      if (mode !== 'account' || activeConversation.current === targetConversationId) setMessages(updatedMessages);
      if (mode === 'account' && body.conversation) {
        const updatedConversation = body.conversation as Conversation;
        setConversations((current) => [updatedConversation, ...current.filter((item) => item.id !== updatedConversation.id)]);
      }
      if (mode !== 'account' || activeConversation.current === targetConversationId) {
        setSafety(Boolean(body.safety_notice));
        setMemoryNotice(body.memory_notice || '');
        setPersistenceNotice(body.persistence_notice || '');
        setSuggestions(body.memory_suggestions || []);
      }
    } catch (requestError) {
      if (mode !== 'account' || activeConversation.current === targetConversationId) {
        setError(requestError instanceof Error ? requestError.message : 'Something went wrong.');
        setDraft(text);
        setMessages(messages);
      }
    } finally {
      setBusy(false);
    }
  }

  function selectConversation(id: string) {
      if (!id || id === requestedConversationId) return;
      activeConversation.current = id;
      setReady(false);
      setMessages([]);
      setError('');
      setConversationId(id);
      setLoadedConversationId('');
      router.push(`/chat?mode=account&conversation_id=${encodeURIComponent(id)}`);
  }

  async function createConversation(): Promise<Conversation | null> {
      if (creatingConversation.current) return null;
      creatingConversation.current = true;
      setError('');
      try {
        const { data: { session } } = await authClient().auth.getSession();
        if (!session) { router.push('/login'); return null; }
        const response = await fetchApi('/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ title: 'New conversation' }),
        });
        if (!response.ok) throw new Error('Could not create a conversation.');
        const conversation: Conversation = await response.json();
        setConversations((current) => [conversation, ...current]);
        setConversationId(conversation.id);
        setLoadedConversationId(conversation.id);
        activeConversation.current = conversation.id;
        setMessages([]);
        setSuggestions([]);
        setHasOlderMessages(false);
        setReady(true);
        router.push(`/chat?mode=account&conversation_id=${encodeURIComponent(conversation.id)}`);
        return conversation;
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Could not create conversation.');
        return null;
      } finally {
        creatingConversation.current = false;
      }
  }

  async function renameConversation() {
      const conversation = conversations.find((item) => item.id === conversationId);
      if (!conversation) return;
      const title = window.prompt('Conversation name', conversation.title)?.trim();
      if (!title || title === conversation.title) return;
      try {
        const { data: { session } } = await authClient().auth.getSession();
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
      if (!conversationId || !window.confirm('Delete this conversation and all messages in it? Saved facts on What Buddy remembers will remain.')) return;
      const targetId = conversationId;
      try {
        const { data: { session } } = await authClient().auth.getSession();
        if (!session) { router.push('/login'); return; }
        const response = await fetchApi(`/conversations/${targetId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!response.ok) throw new Error('Could not delete this conversation.');
        const remaining = conversations.filter((item) => item.id !== targetId);
        setConversations(remaining);
        if (activeConversation.current !== targetId) return;
        setConversationId('');
        setMessages([]);
        setLoadedConversationId('');
        if (remaining[0]) selectConversation(remaining[0].id);
        else {
          activeConversation.current = '';
          router.replace('/chat?mode=account');
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Could not delete conversation.');
      }
  }

  async function loadOlderMessages() {
      if (!conversationId || !messages[0]?.created_at || loadingOlder) return;
      setLoadingOlder(true);
      try {
        const { data: { session } } = await authClient().auth.getSession();
        if (!session) { router.push('/login'); return; }
        const before = encodeURIComponent(messages[0].created_at);
        const response = await fetchApi(`/conversations/${conversationId}/messages?limit=40&before=${before}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!response.ok) throw new Error('Could not load older messages.');
        const older: Msg[] = await response.json();
        if (activeConversation.current === conversationId) {
          setMessages((current) => [...older, ...current]);
          setHasOlderMessages(older.length === 40);
        }
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
      const { data: { session } } = await authClient().auth.getSession();
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
    await authClient().auth.signOut();
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
                    className={`${styles.conversationLink} ${conversation.id === (requestedConversationId || conversationId) ? styles.selected : ''}`}
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
            <strong>{mode === 'account' ? (currentConversation?.title || 'Your Buddy') : 'Buddy'}</strong>
            <span>{mode === 'quick' ? 'Quick chat · Not saved' : 'Your Buddy · Account memory'}</span>
          </div>
          <div className="headerLinks">
            {mode === 'account' && (
              <>
                <button className={styles.headerAction} type="button" disabled={!conversationId || !ready} onClick={() => void renameConversation()}>Rename</button>
                <button className={styles.headerAction} type="button" disabled={!conversationId || !ready || busy} onClick={() => void deleteConversation()}>Delete</button>
                <Link href="/memories">Memories</Link>
              </>
            )}
            <Link href="/">Home</Link>
          </div>
        </header>
        {mode === 'account' && (
          <div className={styles.mobileConversationControls}>
            <select
              value={requestedConversationId || conversationId}
              onChange={(event) => void selectConversation(event.target.value)}
              aria-label="Select conversation"
            >
              {!conversations.length && <option value="">No conversations yet</option>}
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>{conversation.title}</option>
              ))}
            </select>
            <button type="button" onClick={() => void createConversation()}>+ New</button>
          </div>
        )}
        <div className="messageArea">
          <div className="conversation">
            {openingRequestedConversation && <div className="welcome"><p>Opening conversation…</p></div>}
            {mode === 'account' && ready && !conversationId && !requestedConversationId && conversations.length === 0 && messages.length === 0 && (
              <div className="welcome">
                <div className="welcomeIcon"><Heart size={28} /></div>
                <h1>Start a conversation.</h1>
                <p>Your chats will appear here after your first message.</p>
                <span>No empty conversation is saved when you refresh this page.</span>
              </div>
            )}
            {mode === 'account' && !openingRequestedConversation && hasOlderMessages && (
              <button type="button" className={styles.loadOlder} disabled={loadingOlder} onClick={() => void loadOlderMessages()}>
                {loadingOlder ? 'Loading…' : 'Load older messages'}
              </button>
            )}
            {!openingRequestedConversation && visibleMessages.length === 0 && !(mode === 'account' && ready && !conversationId && !requestedConversationId && conversations.length === 0) && (
              <div className="welcome">
                <div className="welcomeIcon"><Heart size={28} /></div>
                <h1>Hey, I&apos;m Buddy.</h1>
                <p>I&apos;m here to listen. What&apos;s on your mind today?</p>
                <span>I&apos;m an AI companion, not a therapist.</span>
              </div>
            )}
            {visibleMessages.map((message, index) => (
              <div key={index} className={'bubble ' + (message.role === 'user' ? 'mine' : 'theirs')}>{message.content}</div>
            ))}
            {mode === 'account' && requestedConversationId && error && ready && !conversationId && (
              <button type="button" className={styles.newConversation} onClick={() => void createConversation()}>
                Start a new conversation
              </button>
            )}
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
