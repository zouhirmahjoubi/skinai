import { useMemo, useRef } from 'react';
import { useStore, useInsights } from '../lib/store.jsx';
import { TopBar, Disclosure } from '../components.jsx';
import { CATALOG, TYPE_LABEL, PRODUCT_BY_ID } from '../../../core/catalog.js';
import { CLASSES, shelfContext, rankShelf, parseInci } from '../../../core/ingredients.js';

function Inci({ product, reasons }) {
  const hits = new Map();
  for (const r of reasons) for (const m of r.matches || []) hits.set(m, r.type);
  return (
    <details className="inci">
      <summary>Ingredients<span className="sr-only"> in {product.name}</span></summary>
      <p>
        {parseInci(product.ingredients).map((name, i, all) => {
          const type = hits.get(name);
          // The separator stays outside the highlight, so neighbouring flagged ingredients don't merge.
          const sep = i < all.length - 1 ? ', ' : '';
          return type ? (
            <span key={i}>
              <mark className={type === 'good' ? 'good' : type}>
                <span className="sr-only">{type === 'good' ? 'helps: ' : 'flagged: '}</span>
                {name}
              </mark>
              {sep}
            </span>
          ) : (
            <span key={i}>{name}{sep}</span>
          );
        })}
      </p>
    </details>
  );
}

function Product({ item, saved, onToggle }) {
  const { product, reasons, verdict } = item;
  const shown = verdict === 'good' ? reasons.filter((r) => r.type === 'good') : reasons.filter((r) => r.type !== 'good');
  const head = useRef(null);
  function toggle() {
    onToggle(product.id);
    // A removed "Not right now" item loses its button; keep focus on the card instead of the page top.
    if (verdict === 'avoid' && saved) requestAnimationFrame(() => head.current?.focus());
  }
  return (
    <article className="product">
      <div>
        <div className="row spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3 ref={head} tabIndex={-1}>{product.name}</h3>
            <div className="line">{TYPE_LABEL[product.type]}, {product.line}, {product.size}</div>
          </div>
          <span className="price">${product.price}</span>
        </div>
        <ul className="reasons">
          {shown.slice(0, 4).map((r) => (
            <li key={r.cls} className={r.type}>
              {r.text}
            </li>
          ))}
          {verdict === 'good' && shown.length === 0 && <li>Nothing that commonly irritates</li>}
        </ul>
        <Inci product={product} reasons={reasons} />
        {(verdict !== 'avoid' || saved) && (
          <div className="row spread" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            {saved ? <span className="fine" style={{ whiteSpace: 'nowrap' }}>On your list</span> : <span />}
            <button type="button" className="btn small secondary" aria-label={saved ? `Remove ${product.name} from my list` : `Save to my list: ${product.name}`} onClick={toggle}>
              {saved ? 'Remove' : 'Save to my list'}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

/** The not-right-now products, grouped by why: a list to scan, not a shelf to shop. */
function AvoidGroups({ items, list, onToggle }) {
  const groups = new Map();
  for (const item of items) {
    const reason = item.reasons.find((r) => r.type === 'avoid');
    const key = reason?.text || 'Not right for you just now';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups].map(([reason, group]) => (
    <div key={reason} className="avoid-group">
      <h3>{reason}</h3>
      <ul>
        {group.map(({ product, reasons }) => (
          <li key={product.id}>
            <span>
              {product.name} <span className="fine">{TYPE_LABEL[product.type].toLowerCase()}</span>
            </span>
            {list.includes(product.id) && (
              <button type="button" className="btn small secondary" aria-label={`Remove ${product.name} from my list`} onClick={() => onToggle(product.id)}>Remove</button>
            )}
            <Inci product={product} reasons={reasons} />
          </li>
        ))}
      </ul>
    </div>
  ));
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
  const mine = [...saved.map((r) => r.product), ...pencils];
  // Removing a row unmounts its button: move focus to the list heading, or the page heading once the list is empty.
  const removeFromList = (id) => {
    toggleList(id);
    requestAnimationFrame(() => {
      const el = document.getElementById('mylist') || document.querySelector('main h1');
      el?.setAttribute('tabindex', '-1');
      el?.focus();
    });
  };
  const item = (r) => <Product key={r.product.id} item={r} saved={list.includes(r.product.id)} onToggle={toggleList} />;

  return (
    <div className="stack-lg">
      <TopBar mode={server.mode} />
      <div className="stack">
        <h1>Your gentle shelf</h1>
        <p className="muted">Every ingredient list is checked against your treatment and your latest check-in.</p>
      </div>

      {/* The moment that matters most: something already on the list stopped being right. */}
      {flagged.filter((r) => r.verdict === 'avoid').map((r) => (
        <article key={r.product.id} className="note call" data-still>
          <div className="note-kicker">On your list, not right now</div>
          <h2 className="note-title">{r.product.name}</h2>
          <p>{r.reasons.find((x) => x.type === 'avoid')?.text}. Check with your care team before using it.</p>
        </article>
      ))}

      {count > 0 && (
        <section className="sheet stack" aria-labelledby="mylist">
          <h2 id="mylist" tabIndex={-1}>My list</h2>
          <p className="small">
            {count} {count === 1 ? 'product' : 'products'}, ${total} in total. Your list goes on your care-team summary so you can check before starting anything new.
          </p>
          {flagged.some((r) => r.verdict === 'caution') && (
            <p className="small">
              <strong>Check again: </strong>
              {flagged.filter((r) => r.verdict === 'caution').map((r) => `${r.product.name} is now under “Use with care”`).join('; ')}.
            </p>
          )}
          {mine.length > 0 && (
            <ul className="list-plain small" style={{ paddingLeft: 0, listStyle: 'none' }}>
              {mine.map((p) => (
                <li key={p.id} className="row spread">
                  <span>
                    {p.hex && <span className="dot" style={{ background: p.hex }} aria-hidden="true" />}
                    {p.name} (${p.price})
                  </span>
                  <button type="button" className="btn small secondary" aria-label={`Remove ${p.name} from my list`} onClick={() => removeFromList(p.id)}>Remove</button>
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
        <Disclosure id="not-now" title="Not right now" hint={`${avoid.length} products, with reasons`}>
          <AvoidGroups items={avoid} list={list} onToggle={toggleList} />
        </Disclosure>
      )}

      <p className="fine">Products are from Shelfside, a fictional demo store.</p>
    </div>
  );
}
