import { useState } from "react";
import { Link } from "react-router-dom";
import useSigns from "../hooks/useSigns.js";
import { Badge, Button, Card, ErrorText, Input, Loading, PageTitle, Readiness, Select } from "../components/ui.jsx";

function AddSignForm({ onAdd }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("static");
  const [startShapes, setStartShapes] = useState("");
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    const err = await onAdd({ label, kind, startShapes });
    setError(err);
    if (!err) {
      setLabel("");
      setStartShapes("");
    }
  };

  return (
    <Card title="Add a sign" className="mb-7">
      <form onSubmit={submit} className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <Input label="Label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="A" required className="w-full sm:w-48" />
        <Select label="Kind" value={kind} onChange={(event) => setKind(event.target.value)} className="w-full sm:w-64">
          <option value="static">Static (held still)</option>
          <option value="motion">Motion (J or Z)</option>
        </Select>
        {kind === "motion" && <Input label="Starts from letter" value={startShapes} onChange={(event) => setStartShapes(event.target.value)} placeholder="I" className="w-full sm:w-48" />}
        <Button variant="primary" type="submit">
          Add sign <span aria-hidden="true">→</span>
        </Button>
      </form>
      <p className="mt-3 text-xs text-[#636B77]">Static (held still) or Motion (J or Z)</p>
      {error && <div className="mt-4"><ErrorText>{error}</ErrorText></div>}
    </Card>
  );
}

function SignRow({ sign }) {
  const isBackground = sign.label === "_none";
  const label = isBackground ? "—" : sign.label;
  const kind = isBackground ? "Not a sign" : sign.kind === "static" ? "Static (held still)" : "Motion (J or Z)";
  const detail = isBackground ? "Background movements for the motion model" : null;
  const value = sign.sample_count / sign.target;

  return (
    <tr>
      <td>
        <span className="inline-flex h-10 min-w-10 items-center justify-center rounded-xl bg-[#EEF4FC] px-3 text-xl font-bold text-[#202630]">{label}</span>
      </td>
      <td>
        <span className="font-semibold text-[#364152]">{kind}</span>
        {detail && <span className="mt-1 block text-xs text-[#7A8493]">{detail}</span>}
      </td>
      <td className="whitespace-nowrap font-medium text-[#364152]">
        {sign.sample_count} / {sign.target} {sign.kind === "static" ? "samples" : "movements"}
      </td>
      <td><Readiness value={value} ready={sign.ready} /></td>
      <td className="text-right">
        <Link to={`/signs/${sign.id}`} className="inline-flex min-h-11 items-center rounded-xl border border-[#C7D5E7] px-3 text-sm font-semibold text-[#32669A] transition hover:border-[#8BB8E8] hover:bg-[#F7FBFF] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8BB8E8]/35">
          View samples
        </Link>
      </td>
    </tr>
  );
}

function SignTable({ title, signs, emptyText }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#DDE4ED] bg-white shadow-[0_1px_2px_rgba(32,38,48,0.02)]">
      <div className="border-b border-[#DDE4ED] px-5 py-4 sm:px-6">
        <h2 className="text-lg font-bold tracking-[-0.02em] text-[#202630]">{title}</h2>
      </div>
      {signs.length === 0 ? (
        <p className="px-5 py-7 text-sm text-[#636B77] sm:px-6">{emptyText}</p>
      ) : (
        <div className="table-scroll">
          <table className="refined-table">
            <thead>
              <tr>
                <th>Letter</th>
                <th>Kind</th>
                <th>Collected</th>
                <th>Readiness</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>{signs.map((sign) => <SignRow key={sign.id} sign={sign} />)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function Signs() {
  const { signs, error, addSign } = useSigns();
  const staticSigns = signs?.filter((sign) => sign.kind === "static") || [];
  const motionSigns = signs?.filter((sign) => sign.kind === "motion") || [];
  const readyStatic = staticSigns.filter((sign) => sign.ready).length;

  return (
    <>
      <PageTitle
        title="Signs overview"
        subtitle={signs ? `${readyStatic} of ${staticSigns.length} static letters ready to train` : "Manage the signs used to train SENYA models."}
        action={
          <Link to="/models" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#C7D5E7] bg-white px-4 text-sm font-semibold text-[#32669A] transition hover:border-[#8BB8E8] hover:bg-[#F7FBFF] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8BB8E8]/35">
            <span aria-hidden="true">◇</span> View models
          </Link>
        }
      />
      <AddSignForm onAdd={addSign} />
      <ErrorText>{error}</ErrorText>
      {!signs && !error && <Loading />}

      {signs && (
        <div className="space-y-6">
          <SignTable title="Static letters" signs={staticSigns} emptyText="No static letters yet. Add one above." />
          <SignTable title="Motion samples" signs={motionSigns} emptyText="No motion samples yet. Add a motion sign when its workflow is ready." />
          <p className="flex items-center gap-2 text-sm text-[#636B77]"><Badge color="gray">i</Badge> Sample targets indicate readiness, not model accuracy.</p>
        </div>
      )}
    </>
  );
}
