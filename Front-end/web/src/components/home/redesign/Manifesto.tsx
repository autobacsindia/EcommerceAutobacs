import { manifesto } from './homeContent';

export default function Manifesto() {
  return (
    <section className="manifesto" id="hr-manifesto">
      <div className="mani-eyebrow reveal">{manifesto.eyebrow}</div>
      <h2 className="reveal reveal-d1">
        {manifesto.titleTop}
        <br />
        <em>{manifesto.titleAccent}</em>
      </h2>
      <p className="reveal reveal-d2">{manifesto.body}</p>
    </section>
  );
}
