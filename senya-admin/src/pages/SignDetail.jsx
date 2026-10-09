import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import useSign from "../hooks/useSign.js";
import { Badge, Button, Card, ConfirmDialog, ErrorText, Input, Loading, PageTitle, ProgressBar, formatDate } from "../components/ui.jsx";

const resultText = (kind, upload) => kind === "static" ? `${upload.samples_added} samples` : `${upload.segments_found} movements`;

const STATUS_TEXT = {
  waiting: "Waiting",
  uploading: "Uploading…",
  extracting: "Finding the hand…",
};

function UploadBox({ sign, onFiles }) {
  const [dragging, setDragging] = useState(false);
  const accept = sign.kind === "motion" ? "video/*" : "video/*,image/*";

  return (
    <label
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); onFiles(event.dataTransfer.files); }}
      className={`flex min-h-[250px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${dragging ? "border-[#32669A] bg-[#F2F8FF]" : "border-[#C7D5E7] bg-[#FBFCFE] hover:border-[#8BB8E8] hover:bg-[#F7FBFF]"}`}
    >
      <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EAF3FF] text-2xl text-[#32669A]" aria-hidden="true">↑</span>
      <span className="text-base font-bold text-[#202630]">Drop clips here, or <span className="text-[#32669A] underline underline-offset-4">Choose files</span></span>
      <span className="mt-3 max-w-md text-sm leading-6 text-[#636B77]">
        {sign.kind === "static"
          ? "Raise your hand, hold A still for about a second, then lower it. Only the held portion is used."
          : sign.label === "_none"
            ? "Ordinary hand movements that are not signs, with a pause between them. Each movement becomes one sample."
            : "Raise your hand, sign it once, lower it. One clip = one sample; the raise and lower also teach _none."}
      </span>
      <input type="file" accept={accept} multiple hidden onChange={(event) => { onFiles(event.target.files); event.target.value = ""; }} />
    </label>
  );
}

function Guidance({ sign }) {
  return (
    <Card eyebrow="Recording guidance" title={sign.kind === "static" ? "Keep the frame calm" : "Make each movement clear"}>
      <div className="space-y-4 text-sm leading-6 text-[#636B77]">
        <p>{sign.kind === "static" ? "Raise your hand, hold the sign still for about a second, then lower it. Only the held portion is used." : "Repeat the movement with a pause between repetitions so each segment can be identified."}</p>
        <p>Keep your head, torso, and signing hand in frame.</p>
        <div className="rounded-xl bg-[#F6F7F9] px-4 py-3 text-xs leading-5 text-[#636B77]">
          Videos are processed for hand landmarks. Original clips are not retained by the admin panel.
        </div>
      </div>
    </Card>
  );
}

function QueueList({ queue, kind, onClear, uploading }) {
  if (queue.length === 0) return null;
  return (
    <Card title="Uploads this session" className="mt-4">
      <ul className="divide-y divide-[#E6EBF1] text-sm">
        {queue.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-4 py-3">
            <span className="truncate font-medium text-[#364152]">{item.file.name}</span>
            {item.status === "done" && <Badge color="green">✓ {resultText(kind, item.result)}</Badge>}
            {item.status === "failed" && <Badge color="red">× {item.error}</Badge>}
            {STATUS_TEXT[item.status] && <Badge color="yellow">{STATUS_TEXT[item.status]}</Badge>}
          </li>
        ))}
      </ul>
      {!uploading && <Button className="mt-4" onClick={onClear}>Clear finished</Button>}
    </Card>
  );
}

function StartShapesForm({ sign, onSave }) {
  const [value, setValue] = useState((sign.start_shapes || []).join(" "));
  const [error, setError] = useState("");

  return (
    <Card title="Starts from letter" className="mb-6">
      <form onSubmit={async (event) => { event.preventDefault(); setError(await onSave(value)); }} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Input value={value} onChange={(event) => setValue(event.target.value)} placeholder="I" className="w-full sm:w-48" />
        <Button type="submit">Save</Button>
      </form>
      {error && <div className="mt-3"><ErrorText>{error}</ErrorText></div>}
    </Card>
  );
}

export default function SignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const s = useSign(id);
  const [actionError, setActionError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);

  if (s.error) return <ErrorText>{s.error}</ErrorText>;
  if (!s.sign) return <Loading />;

  const { sign } = s;
  const isNone = sign.label === "_none";
  const readiness = Math.min(1, sign.sample_count / sign.target);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const pending = pendingDelete;
    setPendingDelete(null);
    if (pending.type === "upload") {
      setActionError(await s.deleteUpload(pending.upload.id));
      return;
    }
    const err = await s.deleteSign();
    err ? setActionError(err) : navigate("/");
  };

  return (
    <>
      <Link to="/" className="mb-5 inline-flex min-h-10 items-center text-sm font-semibold text-[#32669A] hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8BB8E8]/35">
        ← All signs
      </Link>
      <PageTitle
        eyebrow={`Sign detail · ${isNone ? "Not a sign" : sign.label}`}
        title={isNone ? "Not a sign" : `Sign ${sign.label}`}
        subtitle={`${sign.kind === "static" ? "Static" : "Motion"} · ${sign.sample_count} samples · target ${sign.target} · ${sign.ready ? "Ready to train" : "Needs more data"}`}
      />

      <div className="mb-7 flex max-w-2xl items-center gap-3">
        <ProgressBar value={readiness} color={sign.ready ? "green" : "gray"} />
        <span className="shrink-0 text-xs font-semibold text-[#636B77]">{Math.round(readiness * 100)}%</span>
        {sign.ready && <Badge color="green">Ready to train</Badge>}
      </div>
      <ErrorText>{actionError}</ErrorText>

      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <section>
          <Card eyebrow="Add samples" title="Upload clips">
            <UploadBox sign={sign} onFiles={s.addFiles} />
          </Card>
          <QueueList queue={s.queue} kind={sign.kind} onClear={s.clearQueue} uploading={s.uploading} />
        </section>
        <Guidance sign={sign} />
      </div>

      {s.previews.length > 0 && (
        <Card title="Preview frames" className="mt-7">
          <div className="flex gap-3 overflow-x-auto pb-1">
            {s.previews.slice(0, 5).map((preview) => (
              <img key={preview.id} src={preview.thumb} alt="" className="h-20 w-24 shrink-0 rounded-xl border border-[#DDE4ED] object-cover" />
            ))}
          </div>
        </Card>
      )}

      <Card title="Uploaded clips" className="mt-7">
        {s.uploads.length === 0 ? (
          <p className="text-sm text-[#636B77]">No clips yet. Add a recording above to collect samples for this sign.</p>
        ) : (
          <div className="table-scroll">
            <table className="refined-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Samples added</th>
                  <th>Frames without a hand</th>
                  <th>Added</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {s.uploads.map((upload) => (
                  <tr key={upload.id}>
                    <td className="font-semibold">{upload.filename}</td>
                    <td>{resultText(sign.kind, upload)}</td>
                    <td>{upload.no_hand_frames}</td>
                    <td>{formatDate(upload.created_at)}</td>
                    <td className="text-right"><Button variant="quiet" onClick={() => setPendingDelete({ type: "upload", upload })}>Delete</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {sign.kind === "motion" && !isNone && <StartShapesForm sign={sign} onSave={s.saveStartShapes} />}

      {!isNone && (
        <div className="mt-7 border-t border-[#DDE4ED] pt-6">
          <Button variant="danger" onClick={() => setPendingDelete({ type: "sign" })} disabled={s.uploading}>Delete sign {sign.label}</Button>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete?.type === "upload" ? "Delete uploaded clip?" : `Delete sign ${sign.label}?`}
        description={pendingDelete?.type === "upload" ? `Remove ${pendingDelete.upload.filename} and its extracted samples?` : "This removes the sign and all of its samples. This cannot be undone."}
        confirmLabel={pendingDelete?.type === "upload" ? "Delete clip" : "Delete sign"}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
