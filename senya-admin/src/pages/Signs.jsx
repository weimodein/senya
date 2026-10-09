import { useState } from "react";
import { Link } from "react-router-dom";
import useSigns from "../hooks/useSigns.js";
import { Badge, Button, Card, ErrorText, Input, Loading, PageTitle, ProgressBar } from "../components/ui.jsx";

function AddSignForm({ onAdd }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("static");
  const [startShapes, setStartShapes] = useState("");
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    const err = await onAdd({ label, kind, startShapes });
    setError(err);
    if (!err) {
      setLabel("");
      setStartShapes("");
    }
  };

  return (
    <Card title="Add a sign" className="mb-6">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="A" required className="w-24" />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5">
            <option value="static">Static (held still)</option>
            <option value="motion">Motion (moves, like J or Z)</option>
          </select>
        </label>
        {kind === "motion" && (
          <Input label="Starts from letter" value={startShapes} onChange={(e) => setStartShapes(e.target.value)} placeholder="I" className="w-36" />
        )}
        <Button variant="primary" type="submit">
          Add
        </Button>
      </form>
      {error && <div className="mt-3"><ErrorText>{error}</ErrorText></div>}
    </Card>
  );
}

function SignCard({ sign }) {
  return (
    <Link to={`/signs/${sign.id}`} className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-400">
      <div className="flex items-center justify-between">
        <span className="text-3xl font-bold">{sign.label === "_none" ? "—" : sign.label}</span>
        <Badge color={sign.ready ? "green" : "gray"}>{sign.ready ? "Ready" : "Needs data"}</Badge>
      </div>
      <p className="mt-1 text-xs text-gray-500">{sign.label === "_none" ? "Not a sign" : sign.kind}</p>
      <div className="mt-3">
        <ProgressBar value={sign.sample_count / sign.target} color={sign.ready ? "green" : "yellow"} />
      </div>
      <p className="mt-1 text-xs text-gray-600">
        {sign.sample_count} / {sign.target} {sign.kind === "static" ? "samples" : "movements"}
      </p>
    </Link>
  );
}

export default function Signs() {
  const { signs, error, addSign } = useSigns();
  const staticSigns = signs?.filter((s) => s.kind === "static") || [];
  const motionSigns = signs?.filter((s) => s.kind === "motion") || [];

  return (
    <>
      <PageTitle
        title="Signs"
        subtitle={signs && `${staticSigns.filter((s) => s.ready).length} of ${staticSigns.length} static letters are ready to train`}
      />
      <AddSignForm onAdd={addSign} />
      <ErrorText>{error}</ErrorText>
      {!signs && !error && <Loading />}

      {signs && (
        <>
          <h2 className="mb-2 font-semibold">Static letters</h2>
          {staticSigns.length === 0 && <p className="mb-6 text-sm text-gray-500">No static letters yet. Add one above.</p>}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {staticSigns.map((s) => (
              <SignCard key={s.id} sign={s} />
            ))}
          </div>
          <h2 className="mb-2 font-semibold">Motion signs</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {motionSigns.map((s) => (
              <SignCard key={s.id} sign={s} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
