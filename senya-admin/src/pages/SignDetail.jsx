import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import useSign from "../hooks/useSign.js";
import { Badge, Button, Card, ErrorText, Input, Loading, PageTitle, ProgressBar, formatDate } from "../components/ui.jsx";

const resultText = (kind, up) =>
  kind === "static" ? `${up.samples_added} samples` : `${up.segments_found} movements`;

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
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => (e.preventDefault(), setDragging(false), onFiles(e.dataTransfer.files))}
      className={`block cursor-pointer rounded-lg border-2 border-dashed p-8 text-center ${dragging ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white"}`}
    >
      <p className="font-medium">Drop clips here, or click to choose</p>
      <p className="mt-1 text-sm text-gray-500">
        {sign.kind === "static"
          ? "Raise your hand, hold the letter still for about a second, lower it. Only the held part is used."
          : "Repeat the movement a few times with a pause in between. Each repeat becomes one sample."}
      </p>
      <input type="file" accept={accept} multiple hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ""))} />
    </label>
  );
}

function QueueList({ queue, kind, onClear, uploading }) {
  if (queue.length === 0) return null;
  return (
    <Card title="Uploads this session" className="mt-3">
      <ul className="divide-y divide-gray-100 text-sm">
        {queue.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-4 py-2">
            <span className="truncate">{item.file.name}</span>
            {item.status === "done" && <Badge color="green">✓ {resultText(kind, item.result)}</Badge>}
            {item.status === "failed" && <Badge color="red">✗ {item.error}</Badge>}
            {STATUS_TEXT[item.status] && <Badge color="yellow">{STATUS_TEXT[item.status]}</Badge>}
          </li>
        ))}
      </ul>
      {!uploading && (
        <Button className="mt-2" onClick={onClear}>
          Clear finished
        </Button>
      )}
    </Card>
  );
}

function StartShapesForm({ sign, onSave }) {
  const [value, setValue] = useState((sign.start_shapes || []).join(" "));
  const [error, setError] = useState("");
  return (
    <Card title="Starts from letter" className="mb-6">
      <form onSubmit={async (e) => (e.preventDefault(), setError(await onSave(value)))} className="flex items-end gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="I" className="w-36" />
        <Button type="submit">Save</Button>
      </form>
      {error && <div className="mt-2"><ErrorText>{error}</ErrorText></div>}
    </Card>
  );
}

export default function SignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const s = useSign(id);
  const [actionError, setActionError] = useState("");

  if (s.error) return <ErrorText>{s.error}</ErrorText>;
  if (!s.sign) return <Loading />;
  const { sign } = s;
  const isNone = sign.label === "_none";

  const deleteUpload = async (up) => {
    if (window.confirm(`Delete ${up.filename} and its ${resultText(sign.kind, up)}?`)) setActionError(await s.deleteUpload(up.id));
  };
  const deleteSign = async () => {
    if (!window.confirm(`Delete ${sign.label} and all its samples?`)) return;
    const err = await s.deleteSign();
    err ? setActionError(err) : navigate("/");
  };

  return (
    <>
      <Link to="/" className="text-sm text-blue-600 hover:underline">
        ← All signs
      </Link>
      <PageTitle
        title={isNone ? "Not a sign (_none)" : `Sign ${sign.label}`}
        subtitle={`${sign.kind === "static" ? "Static" : "Motion"} · ${sign.sample_count} of ${sign.target} ${sign.kind === "static" ? "samples" : "movements"} needed${sign.ready ? " · ready to train" : ""}`}
      />
      <div className="mb-6 max-w-md">
        <ProgressBar value={sign.sample_count / sign.target} color={sign.ready ? "green" : "yellow"} />
      </div>
      <ErrorText>{actionError}</ErrorText>

      <div className="mb-6">
        <UploadBox sign={sign} onFiles={s.addFiles} />
        <QueueList queue={s.queue} kind={sign.kind} onClear={s.clearQueue} uploading={s.uploading} />
      </div>

      {s.previews.length > 0 && (
        <Card title="Preview frames" className="mb-6">
          <div className="flex flex-wrap gap-2">
            {s.previews.map((p) => (
              <img key={p.id} src={p.thumb} alt="" className="h-16 w-16 rounded object-cover" />
            ))}
          </div>
        </Card>
      )}

      <Card title="Uploaded clips" className="mb-6">
        {s.uploads.length === 0 ? (
          <p className="text-sm text-gray-500">No clips yet. Videos are never stored, only the hand landmarks and small preview frames.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="py-1">File</th>
                <th>Result</th>
                <th>Frames without a hand</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.uploads.map((up) => (
                <tr key={up.id} className="border-t border-gray-100">
                  <td className="py-2">{up.filename}</td>
                  <td>{resultText(sign.kind, up)}</td>
                  <td>{up.no_hand_frames}</td>
                  <td>{formatDate(up.created_at)}</td>
                  <td className="text-right">
                    <Button variant="danger" onClick={() => deleteUpload(up)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {sign.kind === "motion" && !isNone && <StartShapesForm sign={sign} onSave={s.saveStartShapes} />}

      {!isNone && (
        <Button variant="danger" onClick={deleteSign} disabled={s.uploading}>
          Delete sign {sign.label}
        </Button>
      )}
    </>
  );
}
