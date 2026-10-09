import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { extractForSign } from './extract.js';

const pct = (v) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);

function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const reload = useCallback(async () => {
    try { setState({ data: await fn(), error: null, loading: false }); }
    catch (e) { setState((s) => ({ ...s, error: e, loading: false })); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  return [state, reload];
}

function TokenGate({ onDone }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setToken(value.trim());
    try { await api('GET', '/api/signs'); onDone(); }
    catch (err) { setToken(''); setError(err.status === 401 ? 'Wrong admin token.' : err.message); }
  };
  return (
    <form className="gate panel" onSubmit={submit}>
      <h2 style={{ marginTop: 0 }}>Senya platform</h2>
      <p className="muted">Enter the admin token (the ADMIN_TOKEN of the server).</p>
      <div className="row">
        <input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="admin token" autoFocus style={{ flex: 1 }} />
        <button className="btn primary" disabled={!value.trim()}>Enter</button>
      </div>
      {error && <p className="bad">{error}</p>}
    </form>
  );
}

function SignsPage({ onOpen }) {
  const [{ data, error }, reload] = useLoad(() => api('GET', '/api/signs'), []);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('static');
  const [shapes, setShapes] = useState('');
  const [msg, setMsg] = useState('');

  const add = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api('POST', '/api/signs', {
        label: label.trim(), kind,
        start_shapes: kind === 'motion' ? shapes.split(',').map((s) => s.trim()).filter(Boolean) : null,
      });
      setLabel(''); setShapes(''); reload();
    } catch (err) { setMsg(err.message); }
  };
  const remove = async (s) => {
    if (!confirm(`Delete sign ${s.label} and all its data?`)) return;
    try { await api('DELETE', `/api/signs/${s.id}`); reload(); } catch (err) { setMsg(err.message); }
  };

  return (
    <>
      <h2>Signs</h2>
      <form className="panel row" onSubmit={add}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label, e.g. A" style={{ width: 120 }} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="static">static (held still)</option>
          <option value="motion">motion (J, Z …)</option>
        </select>
        {kind === 'motion' && (
          <input value={shapes} onChange={(e) => setShapes(e.target.value)} placeholder="starts from letters, e.g. I" style={{ width: 200 }} />
        )}
        <button className="btn primary" disabled={!label.trim()}>Add sign</button>
        {msg && <span className="bad">{msg}</span>}
      </form>
      {error && <p className="bad">{error.message}</p>}
      <table className="panel">
        <thead><tr><th>Label</th><th>Kind</th><th>Samples</th><th>Uploads</th><th /></tr></thead>
        <tbody>
          {(data || []).map((s) => (
            <tr key={s.id} className="click" onClick={() => onOpen(s)}>
              <td><b>{s.label}</b></td>
              <td><span className="tag">{s.kind}</span></td>
              <td>{s.sample_count}</td>
              <td>{s.upload_count}</td>
              <td style={{ textAlign: 'right' }}>
                {s.label !== '_none' && <button className="btn small danger" onClick={(e) => { e.stopPropagation(); remove(s); }}>Delete</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Static signs need 30+ samples each (at least 2 signs). Motion signs need 20+ movements from 2+ clips, plus <b>_none</b> with 40+ (clips of normal fingerspelling and hands moving in and out).</p>
    </>
  );
}

function SignPage({ sign, onBack }) {
  const [{ data: uploads }, reloadUploads] = useLoad(() => api('GET', `/api/signs/${sign.id}/uploads`), [sign.id]);
  const [{ data: items }, reloadItems] = useLoad(() => api('GET', `/api/signs/${sign.id}/items?limit=60`), [sign.id]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState([]);
  const [shapes, setShapes] = useState((sign.start_shapes || []).join(', '));
  const input = useRef(null);
  const say = (line) => setLog((l) => [...l, line]);

  const run = async () => {
    setBusy(true); setLog([]);
    for (const file of files) {
      try {
        say(`${file.name}: reading hand landmarks in your browser…`);
        setProgress(0);
        const body = await extractForSign(file, sign.kind, setProgress);
        const n = sign.kind === 'static' ? body.samples.length : body.sequences.length;
        if (!n) { say(`${file.name}: no ${sign.kind === 'static' ? 'hand' : 'movement'} found, nothing uploaded (${body.no_hand_frames} frames without a hand)`); continue; }
        const r = await api('POST', `/api/signs/${sign.id}/uploads`, body);
        say(`${file.name}: uploaded ${r.samples_added || r.segments_found} ${sign.kind === 'static' ? 'samples' : 'movements'} (${r.no_hand_frames} frames had no hand)`);
      } catch (err) { say(`${file.name}: FAILED – ${err.message}`); }
    }
    setBusy(false); setFiles([]); if (input.current) input.current.value = '';
    reloadUploads(); reloadItems();
  };
  const removeUpload = async (id) => { await api('DELETE', `/api/uploads/${id}`); reloadUploads(); reloadItems(); };
  const saveShapes = async () => {
    await api('PATCH', `/api/signs/${sign.id}`, { start_shapes: shapes.split(',').map((s) => s.trim()).filter(Boolean) });
    say('start letters saved (used by the next training run)');
  };

  return (
    <>
      <p><button className="btn small" onClick={onBack}>← Signs</button></p>
      <h2 style={{ marginTop: 0 }}>{sign.label} <span className="tag">{sign.kind}</span></h2>
      <div className="panel">
        <p className="muted" style={{ marginTop: 0 }}>
          {sign.kind === 'static'
            ? 'Pick photos or short videos of this letter held still. Vary the background, lighting and distance.'
            : sign.label === '_none'
              ? 'Pick videos of normal fingerspelling and of hands moving in and out of view. Every movement found counts as "not a sign".'
              : 'Pick videos with many repetitions of the movement, with a short pause after each one (about 15 per 30 s clip).'}
        </p>
        <div className="row">
          <input ref={input} type="file" multiple accept={sign.kind === 'static' ? 'image/*,video/*' : 'video/*'}
            onChange={(e) => setFiles([...e.target.files])} disabled={busy} />
          <button className="btn primary" disabled={!files.length || busy} onClick={run}>
            {busy ? 'Working…' : `Extract and upload ${files.length || ''} file${files.length === 1 ? '' : 's'}`}
          </button>
        </div>
        {busy && <div className="bar" style={{ marginTop: 10 }}><div style={{ width: `${progress * 100}%` }} /></div>}
        {log.length > 0 && <div className="log" style={{ marginTop: 10 }}>{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
      </div>

      {sign.kind === 'motion' && sign.label !== '_none' && (
        <div className="panel row">
          <span>Starts from letters:</span>
          <input value={shapes} onChange={(e) => setShapes(e.target.value)} placeholder="e.g. I" style={{ width: 160 }} />
          <button className="btn small" onClick={saveShapes}>Save</button>
          <span className="muted">J starts from I, so a held "I" followed by the movement becomes J.</span>
        </div>
      )}

      <h2>Uploads</h2>
      <table className="panel">
        <thead><tr><th>File</th><th>Samples</th><th>Movements</th><th>No hand</th><th /></tr></thead>
        <tbody>
          {(uploads || []).map((u) => (
            <tr key={u.id}>
              <td>{u.filename}</td><td>{u.samples_added}</td><td>{u.segments_found}</td><td>{u.no_hand_frames}</td>
              <td style={{ textAlign: 'right' }}><button className="btn small danger" onClick={() => removeUpload(u.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {items && items.some((i) => i.thumb) && (
        <>
          <h2>Latest frames</h2>
          <div className="thumbs">{items.filter((i) => i.thumb).map((i) => <img key={i.id + '-' + i.upload_id} src={i.thumb} alt="" />)}</div>
        </>
      )}
    </>
  );
}

function Report({ title, report }) {
  if (!report) return null;
  return (
    <details>
      <summary>{title}</summary>
      <pre>{JSON.stringify({ per_class: report.per_class, most_confused: report.most_confused, warnings: report.warnings,
        real_signs_read_as_none: report.real_signs_read_as_none, none_read_as_a_sign: report.none_read_as_a_sign }, null, 2)}</pre>
    </details>
  );
}

function TrainPage() {
  const [{ data: status }, reloadStatus] = useLoad(() => api('GET', '/api/train/status'), []);
  const [{ data: models }, reloadModels] = useLoad(() => api('GET', '/api/models'), []);
  const [msg, setMsg] = useState('');
  const active = status && (status.status === 'queued' || status.status === 'running');

  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => { reloadStatus(); reloadModels(); }, 2000);
    return () => clearInterval(id);
  }, [active, reloadStatus, reloadModels]);

  const train = async () => {
    setMsg('');
    try { await api('POST', '/api/train'); reloadStatus(); } catch (err) { setMsg(err.message); }
  };
  const publish = async (v) => {
    if (!confirm(`Publish version ${v}? Every phone will download it the next time it checks.`)) return;
    try { await api('POST', `/api/models/${v}/publish`); reloadModels(); } catch (err) { setMsg(err.message); }
  };

  return (
    <>
      <h2>Train</h2>
      <div className="panel">
        <div className="row">
          <button className="btn primary" onClick={train} disabled={active}>{active ? 'Training…' : 'Train a new version'}</button>
          {msg && <span className="bad">{msg}</span>}
        </div>
        {status && (
          <div style={{ marginTop: 12 }}>
            <div className="row"><b>Job {status.id}</b>
              <span className={`tag ${status.status === 'done' ? 'cur' : ''}`}>{status.status}</span>
              <span className="muted">{status.message}</span></div>
            {active && <div className="bar" style={{ marginTop: 8 }}><div style={{ width: `${(status.progress || 0) * 100}%` }} /></div>}
            {status.status === 'queued' && <p className="warn">Waiting for the trainer. Start it on a computer with Python: <code>python -m senya_ml.cli worker</code></p>}
            {status.error && <p className="bad">{status.error}</p>}
          </div>
        )}
      </div>

      <h2>Versions</h2>
      <table className="panel">
        <thead><tr><th>Version</th><th>Letters</th><th>Motion</th><th>Created</th><th /></tr></thead>
        <tbody>
          {(models || []).map((m) => (
            <tr key={m.version}>
              <td><b>v{m.version}</b> {m.is_current && <span className="tag cur">current</span>}</td>
              <td>{pct(m.val_accuracy)} <span className="muted">({m.labels.join(' ')})</span>
                <Report title="report" report={m.report} /></td>
              <td>{m.has_motion ? <>{pct(m.motion_val_accuracy)} <span className="muted">({m.motion_labels.join(' ')})</span>
                <Report title="report" report={m.motion_report} /></> : <span className="muted">none</span>}</td>
              <td className="muted">{new Date(m.created_at).toLocaleString()}</td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn small" disabled={m.is_current} onClick={() => publish(m.version)}>{m.is_current ? 'Published' : 'Publish'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Publishing an older version is a rollback: phones switch to whatever is marked current.</p>
    </>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [tab, setTab] = useState('signs');
  const [sign, setSign] = useState(null);
  if (!authed) return <TokenGate onDone={() => setAuthed(true)} />;
  return (
    <div className="wrap">
      <header>
        <h1>SEN<span>YA</span></h1>
        <nav>
          <button className={tab === 'signs' ? 'on' : ''} onClick={() => { setTab('signs'); setSign(null); }}>Signs</button>
          <button className={tab === 'train' ? 'on' : ''} onClick={() => setTab('train')}>Train &amp; Publish</button>
        </nav>
        <button className="btn small" onClick={() => { setToken(''); setAuthed(false); }}>Sign out</button>
      </header>
      {tab === 'train' ? <TrainPage />
        : sign ? <SignPage key={sign.id} sign={sign} onBack={() => setSign(null)} />
          : <SignsPage onOpen={setSign} />}
    </div>
  );
}
