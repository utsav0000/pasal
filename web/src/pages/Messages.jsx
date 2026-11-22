import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, navigate, useApi, useApp, useRequireAuth, useTitle, useDebounce, api, toast } from '../lib/core.jsx';
import { money, ago, time, date, untilText, toDate } from '../lib/format.js';
import { Button, IconButton, Avatar, Badge, Empty, PageLoader, Seg, Menu, MenuItem, Verified, confirmDialog, Skel } from '../components/ui.jsx';
import { OfferModal, ReportModal } from './Listing.jsx';
import * as I from '../components/icons.jsx';

function OfferCard({ m, me, conv, onChange }) {
  const o = m.offer;
  const mine = o.made_by === me;
  const [busy, setBusy] = useState(null);
  const status = o.expired ? 'expired' : o.status;
  const respond = async (action) => {
    let amount;
    if (action === 'counter') {
      amount = await confirmDialog({ title: 'Send a counter-offer', message: `Asking price ${money(conv.listing.price_minor, o.currency)}`, input: { label: `Your counter (${o.currency === 'NPR' ? 'रू' : '₹'})`, required: true }, confirm: 'Send counter' });
      if (!amount) return;
    }
    setBusy(action);
    try { await api.post(`/offers/${o.id}/respond`, { action, amount }); onChange(); } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  };
  const label = { pending: o.parent_id ? 'Counter-offer' : 'Offer', accepted: 'Accepted', rejected: 'Declined', countered: 'Countered', expired: 'Expired', withdrawn: 'Withdrawn', used: 'Ordered' }[status];
  return (
    <div className={`offer-card ${mine ? 'me' : ''}`}>
      <div className="oc-head"><span className="row" style={{ '--gap': '6px' }}><I.Handshake size={14} />{label}</span>{status === 'pending' && <span className="row" style={{ '--gap': '4px', textTransform: 'none', letterSpacing: 0 }}><I.Clock size={12} />{untilText(o.expires_at)}</span>}</div>
      <div className="oc-amt" style={status === 'rejected' || status === 'expired' || status === 'withdrawn' || status === 'countered' ? { textDecoration: 'line-through', color: 'var(--text-3)' } : undefined}>{money(o.amount_minor, o.currency)}</div>
      <div className="oc-body">{mine ? 'You offered' : `${conv.other.name} offered`} · {Math.round((o.amount_minor / conv.listing.price_minor) * 100)}% of asking{o.message ? <div className="mt-2 text-2">“{o.message}”</div> : null}</div>
      {status === 'pending' && !mine && conv.listing.status === 'active' && (
        <div className="oc-actions">
          <Button size="sm" variant="success" icon={I.Check} loading={busy === 'accept'} onClick={() => respond('accept')}>Accept</Button>
          <Button size="sm" variant="secondary" loading={busy === 'counter'} onClick={() => respond('counter')}>Counter</Button>
          <Button size="sm" variant="ghost" loading={busy === 'reject'} onClick={() => respond('reject')}>Decline</Button>
        </div>
      )}
      {status === 'pending' && mine && <div className="oc-actions"><Button size="sm" variant="ghost" loading={busy === 'withdraw'} onClick={() => respond('withdraw')}>Withdraw offer</Button></div>}
      {status === 'accepted' && conv.role === 'buyer' && <div className="oc-actions"><Button size="sm" variant="gradient" icon={I.Bag} to={`/checkout/${conv.listing.id}?offer=${o.id}`}>Buy at this price</Button><span className="tiny muted" style={{ alignSelf: 'center' }}>{untilText(o.expires_at)}</span></div>}
      {status === 'accepted' && conv.role === 'seller' && <div className="oc-body small" style={{ paddingTop: 0 }}>Waiting for the buyer to check out.</div>}
    </div>
  );
}

function Thread({ id, onBack, onUpdate }) {
  const app = useApp();
  const me = app.user.id;
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [offer, setOffer] = useState(false);
  const [report, setReport] = useState(null);
  const body = useRef(null);
  const typingTimer = useRef(null);
  const lastTyping = useRef(0);
  const stick = useRef(true);
  const load = async () => {
    try { const d = await api(`/conversations/${id}`); setData(d); markRead(); } catch (e) { setErr(e); }
  };
  const markRead = () => api.post(`/conversations/${id}/read`).then(() => onUpdate?.()).catch(() => {});
  useEffect(() => { setData(null); setErr(null); stick.current = true; load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const offs = [
      app.on('message', (d) => {
        if (d.conversation_id !== Number(id)) return;
        setData((s) => (s && !s.messages.some((m) => m.id === d.message.id) ? { ...s, messages: [...s.messages, d.message] } : s));
        if (d.message.sender_id !== me) { setTyping(false); markRead(); }
      }),
      app.on('typing', (d) => {
        if (d.conversation_id !== Number(id)) return;
        setTyping(d.typing);
        clearTimeout(typingTimer.current);
        if (d.typing) typingTimer.current = setTimeout(() => setTyping(false), 5000);
      }),
      app.on('read', (d) => { if (d.conversation_id === Number(id)) setData((s) => s && { ...s, conversation: { ...s.conversation, other_read_at: d.read_at } }); }),
      app.on('offer', () => load()),
      app.on('presence', (d) => setData((s) => (s && s.conversation.other.id === d.user_id ? { ...s, conversation: { ...s.conversation, other: { ...s.conversation.other, online: d.online } } } : s))),
    ];
    return () => offs.forEach((f) => f());
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (stick.current && body.current) body.current.scrollTop = body.current.scrollHeight; }, [data?.messages.length, typing]);
  const older = async () => {
    const first = data.messages[0]?.id;
    const h = body.current.scrollHeight;
    const d = await api(`/conversations/${id}?before=${first}`);
    stick.current = false;
    setData((s) => ({ ...s, messages: [...d.messages, ...s.messages], has_more: d.has_more }));
    requestAnimationFrame(() => { body.current.scrollTop = body.current.scrollHeight - h; });
  };
  const send = async (msg = text) => {
    if (!msg.trim() || sending) return;
    setSending(true); stick.current = true;
    try { const m = await api.post(`/conversations/${id}/messages`, { body: msg }); setText(''); setData((s) => (s.messages.some((x) => x.id === m.id) ? s : { ...s, messages: [...s.messages, m] })); app.send('typing', { conversation_id: Number(id), typing: false }); onUpdate?.(); }
    catch (e) { toast.error(e.message); } finally { setSending(false); }
  };
  const sendImage = async (file) => {
    if (!file) return;
    setSending(true); stick.current = true;
    try {
      const bmp = await createImageBitmap(file);
      const s = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = bmp.width * s; c.height = bmp.height * s; c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const m = await api.post(`/conversations/${id}/messages`, { image: c.toDataURL('image/jpeg', 0.85) });
      setData((st) => (st.messages.some((x) => x.id === m.id) ? st : { ...st, messages: [...st.messages, m] }));
    } catch (e) { toast.error(e.message || 'Could not send image'); } finally { setSending(false); }
  };
  const onType = (v) => {
    setText(v);
    const now = Date.now();
    if (now - lastTyping.current > 2500) { lastTyping.current = now; app.send('typing', { conversation_id: Number(id), typing: true }); }
  };
  if (err) return <div className="chat-main"><Empty icon={I.Alert} title="Conversation unavailable">{err.message}</Empty></div>;
  if (!data) return <div className="chat-main" style={{ padding: 20 }}><Skel h={48} /><div className="mt-4"><Skel h={300} /></div></div>;
  const c = data.conversation;
  const blockToggle = async () => {
    try {
      if (c.blocked_by_me) await api.del(`/users/${c.other.id}/block`);
      else { if (!(await confirmDialog({ title: `Block ${c.other.name}?`, message: 'They won’t be able to message you, and you won’t see their messages.', confirm: 'Block', danger: true }))) return; await api.post(`/users/${c.other.id}/block`); }
      load(); onUpdate?.();
    } catch (e) { toast.error(e.message); }
  };
  let lastDay = null;
  const quick = c.role === 'buyer' ? ['Is this still available?', 'Can I see it today?', 'What’s your best price?', 'Do you deliver?'] : ['Yes, it’s available!', 'Sure, when can you come?', 'The price is slightly negotiable.', 'I can deliver tomorrow.'];
  return (
    <div className="chat-main">
      <div className="chat-head">
        <IconButton icon={I.ArrowLeft} label="Back to conversations" className="show-mobile sm" onClick={onBack} />
        <Link to={`/u/${c.other.id}`} className="row nowrap grow" style={{ '--gap': '12px', minWidth: 0 }}>
          <Avatar name={c.other.name} src={c.other.avatar_url} size={40} online={c.other.online} />
          <div style={{ minWidth: 0 }}><b className="row ellipsis" style={{ '--gap': '5px' }}>{c.other.name}{c.other.verified && <Verified size={14} />}</b><span className="tiny muted">{typing ? <span style={{ color: 'var(--accent-text)' }}>typing…</span> : c.other.online ? 'Online' : `Active ${ago(c.other.last_seen_at)}`}</span></div>
        </Link>
        <Menu trigger={({ toggle }) => <IconButton icon={I.MoreV} label="Conversation options" onClick={toggle} />}>
          <MenuItem icon={I.User} to={`/u/${c.other.id}`}>View profile</MenuItem>
          <MenuItem icon={I.Ban} onClick={blockToggle}>{c.blocked_by_me ? 'Unblock' : 'Block user'}</MenuItem>
          <MenuItem icon={I.Flag} danger onClick={() => setReport({ type: 'user', id: c.other.id })}>Report user</MenuItem>
        </Menu>
      </div>
      <Link to={`/l/${c.listing.slug}`} className="chat-listing">
        <img src={c.listing.thumb} alt="" className="thumb-sm" style={{ width: 44, height: 44 }} />
        <div className="grow" style={{ minWidth: 0 }}><b className="ellipsis small" style={{ display: 'block' }}>{c.listing.title}</b><span className="small semibold">{money(c.listing.price_minor, c.listing.currency)}</span>{c.listing.status !== 'active' && <Badge tone="warn" className="ml-2" style={{ marginLeft: 8 }}>{c.listing.status}</Badge>}</div>
        {c.role === 'buyer' && c.listing.status === 'active' && (
          <div className="row nowrap" onClick={(e) => e.preventDefault()}>
            {c.listing.accept_offers && <Button size="sm" variant="soft" icon={I.Handshake} onClick={() => setOffer(true)} className="hide-mobile">Offer</Button>}
            <Button size="sm" variant="primary" icon={I.Bag} onClick={() => navigate(`/checkout/${c.listing.id}`)}>Buy</Button>
          </div>
        )}
      </Link>
      <div className="chat-body" ref={body} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {data.has_more && <Button size="sm" variant="ghost" onClick={older} style={{ alignSelf: 'center' }}>Load earlier messages</Button>}
        <div className="msg-sys"><I.ShieldCheck size={13} style={{ display: 'inline', verticalAlign: '-2px' }} /> Keep chats and payments on PASAL. Never share OTPs or bank PINs.</div>
        {data.messages.map((m) => {
          const day = date(m.created_at);
          const sep = day !== lastDay ? <div className="day-sep" key={`d${m.id}`}>{day === date(new Date().toISOString()) ? 'Today' : day}</div> : null;
          lastDay = day;
          const mine = m.sender_id === me;
          const read = mine && c.other_read_at && toDate(c.other_read_at) >= toDate(m.created_at);
          if (m.kind === 'system') return <React.Fragment key={m.id}>{sep}<div className="msg-sys">{m.body}</div></React.Fragment>;
          if (m.kind === 'offer' && m.offer) return <React.Fragment key={m.id}>{sep}<OfferCard m={m} me={me} conv={c} onChange={load} /><div className={`msg-time ${mine ? 'me' : ''}`}>{time(m.created_at)}</div></React.Fragment>;
          return (
            <React.Fragment key={m.id}>
              {sep}
              <div className={`msg ${mine ? 'me' : ''}`} onDoubleClick={() => !mine && setReport({ type: 'message', id: m.id })}>
                {m.image_url && <a href={m.image_url} target="_blank" rel="noreferrer"><img src={m.image_url} alt="Shared photo" loading="lazy" /></a>}
                {m.body && <span className="pre">{m.body}</span>}
              </div>
              <div className={`msg-time ${mine ? 'me' : ''}`}>{time(m.created_at)}{mine && (read ? <I.CheckCheck size={14} style={{ color: 'var(--accent-2)' }} aria-label="Read" /> : <I.Check size={14} aria-label="Sent" />)}{!mine && <button className="link tiny" style={{ marginLeft: 6, color: 'var(--text-3)', fontWeight: 500 }} onClick={() => setReport({ type: 'message', id: m.id })}>Report</button>}</div>
            </React.Fragment>
          );
        })}
        {typing && <div className="typing" aria-label={`${c.other.name} is typing`}><i /><i /><i /></div>}
      </div>
      {c.blocked ? (
        <div className="chat-compose"><span className="small muted grow">{c.blocked_by_me ? 'You blocked this user.' : 'You can’t reply to this conversation.'}</span>{c.blocked_by_me && <Button size="sm" variant="secondary" onClick={blockToggle}>Unblock</Button>}</div>
      ) : (
        <>
          {data.messages.filter((m) => m.kind === 'text').length < 3 && <div className="quick-replies">{quick.map((q) => <button key={q} className="chip sm" onClick={() => send(q)}>{q}</button>)}</div>}
          <form className="chat-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <label className="icon-btn" style={{ cursor: 'pointer' }} title="Send a photo"><I.Clip size={20} /><span className="sr-only">Attach photo</span><input type="file" accept="image/*" hidden onChange={(e) => { sendImage(e.target.files[0]); e.target.value = ''; }} /></label>
            <textarea value={text} placeholder="Type a message…" aria-label="Message" rows={1} maxLength={2000}
              onChange={(e) => { onType(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`; }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <Button type="submit" icon={I.Send} aria-label="Send" loading={sending} disabled={!text.trim()} />
          </form>
        </>
      )}
      <OfferModal open={offer} onClose={() => setOffer(false)} listing={{ ...c.listing, seller: c.other }} onDone={load} />
      <ReportModal open={!!report} onClose={() => setReport(null)} type={report?.type} id={report?.id} />
    </div>
  );
}

export default function Messages({ params }) {
  const user = useRequireAuth();
  const app = useApp();
  useTitle('Messages');
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 250);
  const list = useApi(user ? `/conversations?role=${role}&q=${encodeURIComponent(dq)}` : null, { keep: true });
  const active = params.id ? Number(params.id) : null;
  useEffect(() => {
    if (!user) return;
    const off = app.on('message', () => list.reload());
    return off;
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { list.reload(); app.refreshMe(); };
  if (!user) return <PageLoader />;
  return (
    <div className="container" style={{ paddingTop: 24, paddingBottom: 24 }}>
      <div className={`chat ${active ? 'has-active' : ''}`}>
        <aside className="chat-list" aria-label="Conversations">
          <div className="chat-list-head">
            <div className="spread"><h2 style={{ fontSize: 20 }}>Messages</h2>{app.counts.messages > 0 && <Badge tone="accent">{app.counts.messages} unread</Badge>}</div>
            <div className="search-box" style={{ height: 40 }}><I.Search size={16} /><input placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" /></div>
            <Seg full value={role} onChange={setRole} options={[{ value: '', label: 'All' }, { value: 'buying', label: 'Buying' }, { value: 'selling', label: 'Selling' }]} label="Filter" />
          </div>
          <div className="chat-items">
            {list.loading && !list.data && <div style={{ padding: 16 }}><Skel h={56} /><div className="mt-3"><Skel h={56} /></div></div>}
            {list.data?.map((c) => (
              <Link key={c.id} to={`/messages/${c.id}`} replace={!!active} className={`chat-item ${c.id === active ? 'active' : ''}`}>
                <div style={{ position: 'relative' }}>
                  <img className="thumb" src={c.listing.thumb} alt="" />
                  <span style={{ position: 'absolute', bottom: -4, right: -4 }}><Avatar name={c.other.name} src={c.other.avatar_url} size={24} online={c.other.online || app.isOnline(c.other.id)} /></span>
                </div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="spread"><b className="ellipsis small">{c.other.name}</b><span className="tiny muted nowrap">{ago(c.last_message_at)}</span></div>
                  <div className="tiny muted ellipsis">{c.listing.title}</div>
                  <div className="spread mt-1"><span className={`small ellipsis ${c.unread ? 'semibold' : 'muted'}`}>{c.last_message?.kind === 'offer' ? '💬 Offer' : c.last_message?.kind === 'image' ? '📷 Photo' : c.last_message?.body}</span>{c.unread > 0 && c.id !== active && <span className="unread">{c.unread}</span>}</div>
                </div>
              </Link>
            ))}
            {list.data?.length === 0 && <Empty icon={I.Chat} title="No conversations yet" action={<Button size="sm" to="/browse">Browse listings</Button>}>Chat with a seller from any listing.</Empty>}
          </div>
        </aside>
        {active ? <Thread id={active} onBack={() => navigate('/messages')} onUpdate={refresh} /> : (
          <div className="chat-main hide-mobile" style={{ display: 'grid', placeItems: 'center' }}><Empty icon={I.MessageText} title="Select a conversation">Your chats with buyers and sellers appear here in real time.</Empty></div>
        )}
      </div>
    </div>
  );
}
