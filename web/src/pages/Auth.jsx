import React, { useEffect, useRef, useState } from 'react';
import { Link, navigate, useApi, useApp, useLocation, useTitle, api, toast } from '../lib/core.jsx';
import { Button, Field, Input, Seg, Logo, SuccessBurst, Spinner } from '../components/ui.jsx';
import * as I from '../components/icons.jsx';

const DEV = window.__PASAL__?.devTools;

function AuthShell({ title, subtitle, children }) {
  return (
    <div className="auth">
      <div className="auth-form">
        <div className="inner">
          <Link to="/" className="show-mobile mb-5" style={{ display: 'inline-block' }}><Logo height={34} /></Link>
          <h1 style={{ fontSize: 30 }}>{title}</h1>
          {subtitle && <p className="muted mt-2 mb-5">{subtitle}</p>}
          {children}
        </div>
      </div>
      <div className="auth-art">
        <div className="hero-mesh" aria-hidden="true"><span /><span /><span /></div>
        <div className="float-chip" style={{ top: '14%', left: '12%', color: 'var(--text)' }}><span className="ic" style={{ background: '#12C08A' }}><I.Handshake size={16} /></span>Offer accepted</div>
        <div className="float-chip" style={{ top: '26%', right: '10%', animationDelay: '-2s', color: 'var(--text)' }}><span className="ic" style={{ background: 'var(--accent)' }}><I.BadgeCheck size={16} /></span>Verified seller</div>
        <div className="float-chip" style={{ top: '40%', left: '24%', animationDelay: '-4s', color: 'var(--text)' }}><span className="ic" style={{ background: 'var(--accent-2)' }}><I.Truck size={16} /></span>Out for delivery</div>
        <Logo height={44} color="#fff" />
        <h2 className="mt-5">Everything finds a buyer<span style={{ color: '#2EE6A6' }}>.</span></h2>
        <p>Buy and sell across India and Nepal with verified sellers, real-time chat, offers, and protected payments.</p>
      </div>
    </div>
  );
}

function GoogleButton() {
  const prov = useApi('/auth/providers');
  if (!prov.data?.google) return null;
  return (
    <>
      <a className="btn btn-secondary btn-block google-btn" href="/api/v1/auth/google/start"><I.GoogleG />Continue with Google</a>
      <div className="or">or</div>
    </>
  );
}

function OtpInput({ value, onChange }) {
  const refs = useRef([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');
  const set = (i, d) => { const arr = value.padEnd(6, ' ').split(''); arr[i] = d || ' '; onChange(arr.join('').replace(/\s+$/, '').replace(/ /g, '')); };
  return (
    <div className="otp" onPaste={(e) => { const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (t) { e.preventDefault(); onChange(t); refs.current[Math.min(5, t.length)]?.focus(); } }}>
      {digits.map((d, i) => (
        <input key={i} ref={(el) => (refs.current[i] = el)} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={1} value={d.trim()} aria-label={`Digit ${i + 1}`}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(-1); set(i, v); if (v && i < 5) refs.current[i + 1]?.focus(); }}
          onKeyDown={(e) => { if (e.key === 'Backspace' && !d.trim() && i > 0) refs.current[i - 1]?.focus(); }} />
      ))}
    </div>
  );
}

function PhoneLogin({ next }) {
  const app = useApp();
  const [country, setCountry] = useState(app.country);
  const [phone, setPhone] = useState('');
  const [stage, setStage] = useState('phone');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [timer, setTimer] = useState(0);
  useEffect(() => { if (!timer) return; const t = setTimeout(() => setTimer(timer - 1), 1000); return () => clearTimeout(t); }, [timer]);
  const request = async () => {
    setBusy(true); setErr('');
    try { await api.post('/auth/otp/request', { phone, country }); setStage('code'); setTimer(30); toast.success(`Code sent to ${country === 'IN' ? '+91' : '+977'} ${phone}`); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post('/auth/otp/verify', { phone, country, code, name: stage === 'name' ? name : undefined });
      if (r.needsName) { setStage('name'); return; }
      await app.refreshMe(); toast.success(`Welcome, ${r.user.name.split(' ')[0]}!`); navigate(next, { replace: true });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <form className="stack" style={{ '--gap': '16px' }} onSubmit={(e) => { e.preventDefault(); stage === 'phone' ? request() : verify(); }}>
      {stage === 'phone' && <>
        <Seg full value={country} onChange={setCountry} options={[{ value: 'IN', label: '🇮🇳 India +91' }, { value: 'NP', label: '🇳🇵 Nepal +977' }]} label="Country code" />
        <Field label="Mobile number" error={err}>
          <div className="input-group"><span className="addon">{country === 'IN' ? '+91' : '+977'}</span><input className="input" inputMode="tel" autoComplete="tel-national" placeholder={country === 'IN' ? '98765 43210' : '98XXXXXXXX'} value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ''))} required /></div>
        </Field>
        <Button type="submit" block size="lg" loading={busy}>Send code</Button>
      </>}
      {stage === 'code' && <>
        <p className="small text-2">Enter the 6-digit code sent to <b>{country === 'IN' ? '+91' : '+977'} {phone}</b>. <button type="button" className="link" onClick={() => setStage('phone')}>Change</button></p>
        <OtpInput value={code} onChange={setCode} />
        {err && <span className="error-text">{err}</span>}
        <Button type="submit" block size="lg" loading={busy} disabled={code.length !== 6}>Verify &amp; continue</Button>
        <button type="button" className="link small" disabled={timer > 0} onClick={request}>{timer > 0 ? `Resend code in ${timer}s` : 'Resend code'}</button>
        {DEV && <p className="tiny muted">Dev mode: SMS is not sent. Read the code in the <a className="link" href="/dev/mailbox" target="_blank" rel="noreferrer">dev mailbox</a>.</p>}
      </>}
      {stage === 'name' && <>
        <p className="small text-2">Number verified. What should we call you?</p>
        <Field label="Full name" error={err}><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus required minLength={2} /></Field>
        <Button type="submit" block size="lg" loading={busy}>Create account</Button>
      </>}
    </form>
  );
}

export function Login() {
  useTitle('Sign in');
  const app = useApp();
  const { query } = useLocation();
  const next = query.next && query.next.startsWith('/') ? query.next : '/';
  const [mode, setMode] = useState('email');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(query.error ? 'Google sign-in did not complete. Please try again.' : '');
  useEffect(() => { if (app.user) navigate(next, { replace: true }); }, [app.user]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.post('/auth/login', { email, password: pw }); await app.refreshMe(); toast.success(`Welcome back, ${r.user.name.split(' ')[0]}!`); navigate(next, { replace: true }); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to chat with sellers, make offers and track orders.">
      <GoogleButton />
      <Seg full value={mode} onChange={setMode} options={[{ value: 'email', label: 'Email', icon: I.Mail }, { value: 'phone', label: 'Phone OTP', icon: I.Phone }]} label="Sign-in method" />
      <div className="mt-5">
        {mode === 'email' ? (
          <form className="stack" style={{ '--gap': '16px' }} onSubmit={submit}>
            <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label={<span className="spread w-full">Password<Link to="/forgot-password" className="link small">Forgot?</Link></span>} htmlFor="pw" error={err}><Input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
            <Button type="submit" block size="lg" loading={busy}>Sign in</Button>
          </form>
        ) : <PhoneLogin next={next} />}
      </div>
      <p className="center small muted mt-5">New to PASAL? <Link to={`/register${query.next ? `?next=${encodeURIComponent(query.next)}` : ''}`} className="link">Create an account</Link></p>
      {DEV && (
        <div className="callout mt-5 small" style={{ flexDirection: 'column', gap: 8 }}>
          <b>Demo accounts</b>
          <div className="chips">
            {[['Buyer', 'buyer@pasal.example', 'Buyer@12345'], ['Seller', 'seller@pasal.example', 'Seller@12345'], ['Nepal buyer', 'buyer.np@pasal.example', 'Buyer@12345'], ['Admin', 'admin@pasal.example', 'Admin@12345']].map(([l, e, p]) => (
              <button key={l} type="button" className="chip sm" onClick={() => { setMode('email'); setEmail(e); setPw(p); }}>{l}</button>
            ))}
          </div>
        </div>
      )}
    </AuthShell>
  );
}

export function Register() {
  useTitle('Create your account');
  const app = useApp();
  const { query } = useLocation();
  const [f, setF] = useState({ name: '', email: '', password: '', country: app.country });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState({});
  const [agree, setAgree] = useState(false);
  const strength = [/.{8,}/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(f.password)).length;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr({});
    try { await api.post('/auth/register', f); await app.refreshMe(); toast.success('Account created! Check your email to verify it.'); navigate(query.next?.startsWith('/') ? query.next : '/dashboard', { replace: true }); }
    catch (e2) { setErr({ ...(e2.fields || {}), _: e2.message }); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Create your account" subtitle="It’s free. Start buying and selling in minutes.">
      <GoogleButton />
      <form className="stack" style={{ '--gap': '16px' }} onSubmit={submit}>
        <Field label="Full name" error={err.name}><Input autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Email" error={err.email}><Input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Password" error={err.password} help="At least 8 characters with a letter and a number.">
          <Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
          <div className="progress" style={{ height: 4, marginTop: 6 }} aria-hidden="true"><i style={{ width: `${strength * 25}%`, background: strength < 2 ? 'var(--danger)' : strength < 3 ? 'var(--warning)' : 'var(--success)' }} /></div>
        </Field>
        <Field label="I’m in"><Seg full value={f.country} onChange={(v) => setF({ ...f, country: v })} options={[{ value: 'IN', label: '🇮🇳 India' }, { value: 'NP', label: '🇳🇵 Nepal' }]} label="Country" /></Field>
        <label className="check small"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required /><span>I agree to the <Link to="/terms" className="link">Terms</Link>, <Link to="/privacy" className="link">Privacy policy</Link> and <Link to="/prohibited-items" className="link">Prohibited items policy</Link>.</span></label>
        {err._ && <div className="callout danger small"><I.Alert size={16} />{err._}</div>}
        <Button type="submit" block size="lg" loading={busy} disabled={!agree}>Create account</Button>
      </form>
      <p className="center small muted mt-5">Already have an account? <Link to="/login" className="link">Sign in</Link></p>
    </AuthShell>
  );
}

export function Forgot() {
  useTitle('Reset password');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => { e.preventDefault(); setBusy(true); try { await api.post('/auth/forgot', { email }); setSent(true); } catch (e2) { toast.error(e2.message); } finally { setBusy(false); } };
  return (
    <AuthShell title="Forgot your password?" subtitle="We’ll email you a secure link to reset it.">
      {sent ? (
        <div className="stack center" style={{ '--gap': '14px' }}>
          <SuccessBurst />
          <h3>Check your inbox</h3>
          <p className="muted">If an account exists for <b>{email}</b>, a reset link is on its way. It expires in 1 hour.</p>
          {DEV && <a className="link small" href="/dev/mailbox" target="_blank" rel="noreferrer">Open dev mailbox</a>}
          <Button variant="secondary" to="/login">Back to sign in</Button>
        </div>
      ) : (
        <form className="stack" style={{ '--gap': '16px' }} onSubmit={submit}>
          <Field label="Email"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          <Button type="submit" block size="lg" loading={busy}>Send reset link</Button>
          <Link to="/login" className="link small center">Back to sign in</Link>
        </form>
      )}
    </AuthShell>
  );
}

export function Reset() {
  useTitle('Choose a new password');
  const { query } = useLocation();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post('/auth/reset', { token: query.token, password: pw }); toast.success('Password updated. Please sign in.'); navigate('/login', { replace: true }); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Choose a new password" subtitle="You’ll be signed out of other devices.">
      <form className="stack" style={{ '--gap': '16px' }} onSubmit={submit}>
        <Field label="New password" error={err} help="At least 8 characters with a letter and a number."><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></Field>
        <Button type="submit" block size="lg" loading={busy} disabled={!query.token}>Update password</Button>
      </form>
    </AuthShell>
  );
}

export function VerifyEmail() {
  useTitle('Verify email');
  const { query } = useLocation();
  const app = useApp();
  const [state, setState] = useState('loading');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!query.token) { setState('error'); setMsg('This link is missing its token.'); return; }
    api.post('/auth/verify-email', { token: query.token }).then(() => { setState('ok'); app.refreshMe(); }).catch((e) => { setState('error'); setMsg(e.message); });
  }, [query.token]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="container page"><div className="card card-pad-lg center stack" style={{ maxWidth: 480, margin: '40px auto', '--gap': '16px', alignItems: 'center' }}>
      {state === 'loading' && <Spinner />}
      {state === 'ok' && <><SuccessBurst /><h2>Email verified</h2><p className="muted">You can now publish listings and place orders.</p><Button to="/sell" icon={I.Plus}>Post your first listing</Button></>}
      {state === 'error' && <><div className="empty" style={{ padding: 0 }}><div className="ic"><I.Alert size={32} /></div></div><h2>Link didn’t work</h2><p className="muted">{msg}</p><Button variant="secondary" to="/settings">Resend from settings</Button></>}
    </div></div>
  );
}
