import { useMemo } from 'react';
import { useStore, useInsights } from '../lib/store.jsx';
import { TopBar } from '../components.jsx';
import { CATALOG, TYPE_LABEL, PRODUCT_BY_ID } from '../../../core/catalog.js';
import { CLASSES, shelfContext, rankShelf, parseInci } from '../../../core/ingredients.js';

function Inci({ product, reasons }) {
  const hits = new Map();
  for (const r of reasons) for (const m of r.matches || []) hits.set(m, r.type);
  return (
    <details className="inci">
      <summary>Ingredients</summary>
      <p>
        {parseInci(product.ingredients).map((name, i, all) => {
          const type = hits.get(name);
          const text = `${name}${i < all.length - 1 ? ', ' : ''}`;
          return type ? (
            <mark key={i} className={type === 'good' ? 'good' : type}>
              {text}
            </mark>
          ) : (
            <span key={i}>{text}</span>
          );
        })}
      </p>
    </details>
  );
}

function Product({ item, saved, onToggle }) {
  const { product, reasons, verdict } = item;
  const shown = verdict === 'good' ? reasons.filter((r) => r.type === 'good') : reasons.filter((r) => r.type !== 'good');
  return (
    <article className="product">
      <div className="pack" aria-hidden="true">{TYPE_LABEL[product.type]}</div>
      <div>
        <div className="row spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3>{product.name}</h3>
            <div className="line">{product.line}, {product.size}</div>
          </div>
          <span className="price">${product.price}</span>
        </div>
        <ul className="reasons">
          {shown.slice(0, 4).map((r) => (
            <li key={r.cls} className={r.type}>
              {r.type === 'good' ? `Has ${r.text.toLowerCase()}` : r.text}
            </li>
          ))}
          {verdict === 'good' && shown.length === 0 && <li>Nothing that commonly irritates</li>}
        </ul>
        <Inci product={product} reasons={reasons} />
        {(verdict !== 'avoid' || saved) && (
          <div className="row spread" style={{ marginTop: 10 }}>
            {saved ? <span className="fine">On your list</span> : <span />}
            <button type="button" className="btn small secondary" aria-pressed={saved} onClick={() => onToggle(product.id)}>
              {saved ? 'Remove from my list' : 'Save to my list'}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export default function Shelf() {
  const { profile, server, list = [], toggleList } = useStore();
  const { notes } = useInsights();
  const ctx = useMemo(() => shelfContext(profile, notes), [profile, notes]);
  const ranked = useMemo(() => rankShelf(CATALOG, ctx), [ctx]);
  const good = ranked.filter((r) => r.verdict === 'good');
  const caution = ranked.filter((r) => r.verdict === 'caution');
  const avoid = ranked.filter((r) => r.verdict === 'avoid');
  const driving = notes.filter((n) => n.avoid?.length || n.level === 'call');
  const saved = ranked.filter((r) => list.includes(r.product.id));
  // Brow pencils share the list but have no ingredient verdict.
  const pencils = list.map((id) => PRODUCT_BY_ID[id]).filter((p) => p && p.hex);
  const count = saved.length + pencils.length;
  const total = saved.reduce((sum, r) => sum + r.product.price, 0) + pencils.reduce((sum, p) => sum + p.price, 0);
  const flagged = saved.filter((r) => r.verdict !== 'good');
  const item = (r) => <Product key={r.product.id} item={r} saved={list.includes(r.product.id)} onToggle={toggleList} />;

  return (
    <div className="stack-lg">
      <TopBar mode={server.mode} />
      <div className="stack">
        <h1>Your gentle shelf</h1>
        <p className="muted">Every product’s ingredient list is checked against your treatments and your latest check-in. The shelf changes as your skin does.</p>
      </div>

      {count > 0 && (
        <section className="sheet stack" aria-labelledby="mylist">
          <h2 id="mylist">My list</h2>
          <p className="small">
            {count} {count === 1 ? 'product' : 'products'}, ${total} in total. Your list goes on your care-team summary so you can check before starting anything new.
          </p>
          {flagged.length > 0 && (
            <p className="small">
              <strong>Check again: </strong>
              {flagged.map((r) => `${r.product.name} is now under “${r.verdict === 'avoid' ? 'Not right now' : 'Use with care'}”`).join('; ')}.
            </p>
          )}
          {pencils.length > 0 && (
            <ul className="list-plain small" style={{ paddingLeft: 0, listStyle: 'none' }}>
              {pencils.map((p) => (
                <li key={p.id} className="row spread">
                  <span>
                    <span className="dot" style={{ background: p.hex }} aria-hidden="true" />
                    {p.name} (${p.price})
                  </span>
                  <button type="button" className="btn small secondary" aria-label={`Remove ${p.name} from my list`} onClick={() => toggleList(p.id)}>Remove</button>
                </li>
              ))}
            </ul>
          )}
          <a className="btn small secondary" href="#/report">Open care-team summary</a>
        </section>
      )}

      <section className="sheet stack" aria-labelledby="rules">
        <h2 id="rules">This week’s rules</h2>
        {driving.length > 0 && (
          <p className="small">
            Based on your last check-in: <strong>{driving.map((n) => n.subtitle || n.title).join('; ')}</strong>.
          </p>
        )}
        {ctx.avoid.length > 0 && (
          <div>
            <p className="small"><strong>Avoid for now</strong></p>
            <div className="chips" style={{ marginTop: 6 }}>
              {ctx.avoid.map((c) => <span key={c} className="chip avoid">{CLASSES[c].label}</span>)}
            </div>
          </div>
        )}
        <div>
          <p className="small"><strong>Use with care while skin is sensitive</strong></p>
          <div className="chips" style={{ marginTop: 6 }}>
            {ctx.caution.map((c) => <span key={c} className="chip">{CLASSES[c].label}</span>)}
          </div>
        </div>
        <div>
          <p className="small"><strong>Look for</strong></p>
          <div className="chips" style={{ marginTop: 6 }}>
            {ctx.needs.map((c) => <span key={c} className="chip need">{CLASSES[c].label}</span>)}
          </div>
        </div>
        <p className="fine">If your care team prescribed something for your skin, use that first. Ask before starting any active ingredient during treatment.</p>
      </section>

      <section aria-labelledby="good">
        <div className="section-title">
          <h2 id="good">Good for you now</h2>
          <span className="fine">{good.length} products</span>
        </div>
        {good.map(item)}
      </section>

      {caution.length > 0 && (
        <section aria-labelledby="caution">
          <div className="section-title">
            <h2 id="caution">Use with care</h2>
            <span className="fine">{caution.length}</span>
          </div>
          {caution.map(item)}
        </section>
      )}

      {avoid.length > 0 && (
        <details className="sheet">
          <summary style={{ cursor: 'pointer' }}>
            <h2 style={{ display: 'inline' }}>Not right now</h2> <span className="fine">({avoid.length}, with reasons)</span>
          </summary>
          <div style={{ marginTop: 12 }}>
            {avoid.map(item)}
          </div>
        </details>
      )}

      <p className="fine">Products are from Shelfside, a fictional demo store. A retailer can plug in its own catalog and cart: Ahead only needs each product’s ingredient list.</p>
    </div>
  );
}
