// VTH-monitor: alle berekeningen (zonder DOM), zodat ze ook los te controleren zijn met node.
// Definities gelijk aan de SQL-views (stap 2) en het Power BI-model.
function maakModel(D) {
  const LK = D.lk, PEIL = D.peil;
  const dt = d => new Date(Date.UTC(2020, 0, 1 + d));
  const Y = d => d < 0 ? -1 : dt(d).getUTCFullYear();
  const M = d => d < 0 ? -1 : dt(d).getUTCMonth();            // 0..11
  const ix = (lk, naam) => LK[lk].indexOf(naam);
  const fmtD = d => { if (d < 0) return ''; const x = dt(d); return String(x.getUTCDate()).padStart(2, '0') + '-' + String(x.getUTCMonth() + 1).padStart(2, '0') + '-' + x.getUTCFullYear(); };
  const KWARTAAL = d => Math.floor(M(d) / 3) + 1;

  // ---- zaken
  const Z = D.zaken.map((z, i) => {
    const code = LK.type[z[1]];
    return { i, nr: z[0], code, oms: D.typeOms[code] || code, dom: D.domein[code] || 'Overig', s: z[2], e: z[3], u: z[4],
      res: LK.res[z[5]], kern: LK.kern[z[6]], ops: (z[7] & 1) > 0, ver: (z[7] & 2) > 0, sy: Y(z[2]), sm: M(z[2]), ey: Y(z[3]), em: M(z[3]) };
  });
  Z.forEach(z => { z.open = z.e < 0; z.dlt = z.open ? null : z.e - z.s; z.bt = (z.open || z.u < 0) ? null : (z.e <= z.u ? 1 : 0); });
  const kernVanZaak = i => i >= 0 ? Z[i].kern : null;
  const codeVanZaak = i => i >= 0 ? Z[i].code : null;

  // ---- overige bronnen
  const ACT = D.act.map(a => ({ jv: LK.jv[a[0]], d: a[1], y: Y(a[1]), m: M(a[1]), z: a[2] }));
  const INS = D.insp.map((r, i) => ({ i, d: r[0], y: Y(r[0]), m: M(r[0]), typ: LK.ityp[r[1]], ond: LK.ond[r[2]], neg: r[3], z: r[4] }));
  const CON = D.constat.map(c => ({ ins: INS[c[0]], thema: LK.thema[c[1]], gevolg: c[2] >= 0 ? LK.gevolg[c[2]] : null }));
  const SAN = D.sanctie.map(s => ({ ins: INS[s[0]], sanctie: LK.sanctie[s[1]] }));
  const BES = D.besl.map(b => ({ d: b[0], y: Y(b[0]), m: M(b[0]), groep: LK.besluit[b[1]], z: b[2] }));
  const ZW = D.zienswijze.map(s => ({ d: s[0], y: Y(s[0]), m: M(s[0]), z: s[1] }));
  const PUB = D.publ.map(p => ({ d: p[0], y: Y(p[0]), m: M(p[0]), z: p[1] }));
  const VERVOLG = new Set(D.vervolg);
  const LEG = D.leges.map(l => ({ z: l[0], b: l[1], f: l[2], fy: Y(l[2]), fm: M(l[2]) }));
  const EV = D.even.map(e => ({ z: e[0], naam: e[1], type: LK.evtype[e[2]], a: e[3], b: e[4], van: e[5], tot: e[6], bez: e[7], lat: e[8], lon: e[9], loc: e[10], risico: e[11] }));
  EV.forEach(e => { const zk = Z[e.z]; e.nr = zk.nr; e.kern = zk.kern; e.status = zk.open ? 'In behandeling' : zk.res; e.ay = Y(e.a); e.am = M(e.a); });

  // ---- filters
  // f = {jaar, kwartaal (0 = heel jaar), kern ('' = alle)}
  const inPer = (d, f) => d >= 0 && Y(d) === f.jaar && (!f.kwartaal || KWARTAAL(d) === f.kwartaal);
  const okKern = (k, f) => !f.kern || k === f.kern;
  const okKernZ = (zi, f) => !f.kern || (zi >= 0 && Z[zi].kern === f.kern);
  const zaken = (f, codes, opEind) => Z.filter(z => okKern(z.kern, f) && (!codes || codes.includes(z.code)) && inPer(opEind ? z.e : z.s, f));
  const OV = ['OV-REG'];
  const pct = (a, b) => b ? a / b : null;
  const ins = f => INS.filter(r => inPer(r.d, f) && okKernZ(r.z, f));
  const insSet = f => new Set(ins(f).map(r => r.i));

  // ---- kengetallen
  function vergunningen(f) {
    const ov = zaken(f, OV);
    const af = ov.filter(z => !z.open);
    const bt = ov.filter(z => z.bt === 1).length;
    return {
      aanvragen: ov.length, afgehandeld: af.length, open: ov.length - af.length, binnen8w: ov.filter(z => z.dlt !== null && z.dlt <= 56).length,
      binnenTermijn: bt, pctTermijn: pct(bt, ov.length), pctTermijnAf: pct(bt, af.length),
      doorlooptijd: af.length ? af.reduce((a, z) => a + z.dlt, 0) / af.length : null,
      opschorting: ov.filter(z => z.ops).length, verlenging: ov.filter(z => z.ver).length,
      verleend: ov.filter(z => z.res === 'Verleend').length,
      concept: zaken(f, ['CONCEPT']).length, conceptOordeel: zaken(f, ['CONCEPT']).filter(z => z.res === 'Akkoord' || z.res === 'Niet akkoord').length,
      publicaties: PUB.filter(p => inPer(p.d, f) && okKernZ(p.z, f) && ['OV-REG', 'OV-UIT', 'OV-WABO'].includes(codeVanZaak(p.z))).length,
      resultaten: telBy(ov, z => z.res),
    };
  }
  function toezicht(f) {
    const I = ins(f); const s = new Set(I.map(r => r.i));
    const con = CON.filter(c => s.has(c.ins.i)); const san = SAN.filter(x => s.has(x.ins.i));
    const besl = BES.filter(b => inPer(b.d, f) && okKernZ(b.z, f));
    const mel = zaken(f, ['HH-MELD']);
    return {
      controles: I.length, metOvertreding: I.filter(r => r.neg > 0).length, pctOvertreding: pct(I.filter(r => r.neg > 0).length, I.length),
      overtredingen: con.length, zonderGevolg: con.filter(c => !c.gevolg).length,
      waarschuwing: san.filter(x => x.sanctie === 'Waarschuwingsbrief').length, vooraanschrijving: san.filter(x => x.sanctie === 'Vooraanschrijving').length,
      sancties: san.length, handhavingsbesluiten: besl.filter(b => b.groep === 'Handhavingsbesluit').length,
      verbeurd: besl.filter(b => b.groep === 'Verbeurdverklaring').length, invordering: besl.filter(b => b.groep === 'Invorderingsbesluit').length,
      meldingen: mel.length, meldingNaarHH: mel.filter(z => VERVOLG.has(z.i)).length,
      perThema: telBy(con, c => c.thema), perOnderwerp: groepeer(I, r => r.ond, rs => ({ controles: rs.length, overtreding: rs.filter(r => r.neg > 0).length })),
      perMaand: perMaand(I, r => r.m),
    };
  }
  function werkvoorraad(f) {
    const open = Z.filter(z => z.open && okKern(z.kern, f) && (!f.domein || z.dom === f.domein));
    const over = open.filter(z => z.u >= 0 && z.u < PEIL);
    const bijna = open.filter(z => z.u >= PEIL && z.u <= PEIL + 14);
    const leeftijd = open.map(z => PEIL - z.s);
    const bucket = d => d < 56 ? '< 8 weken' : d < 91 ? '8 weken – 3 maanden' : d < 182 ? '3 – 6 maanden' : d < 365 ? '6 – 12 maanden' : '> 1 jaar';
    const BK = ['< 8 weken', '8 weken – 3 maanden', '3 – 6 maanden', '6 – 12 maanden', '> 1 jaar'];
    const perType = groepeer(open, z => z.code, rs => ({ open: rs.length, over: rs.filter(z => z.u >= 0 && z.u < PEIL).length, oms: rs[0].oms }));
    return {
      open: open.length, over: over.length, bijna: bijna.length, gemLeeftijd: leeftijd.length ? leeftijd.reduce((a, b) => a + b, 0) / leeftijd.length : null,
      ouderdom: BK.map(b => [b, open.filter(z => bucket(PEIL - z.s) === b).length]), perType,
      lijst: open.map(z => ({ nr: z.nr, code: z.code, oms: z.oms, kern: z.kern, start: z.s, uiterlijk: z.u, over: (z.u >= 0 && z.u < PEIL) ? PEIL - z.u : 0,
        signaal: (z.u >= 0 && z.u < PEIL) ? 'Over termijn' : (z.u >= PEIL && z.u <= PEIL + 14) ? 'Verloopt binnen 14 dagen' : '' }))
        .sort((a, b) => b.over - a.over || a.uiterlijk - b.uiterlijk),
    };
  }
  function leges(f) {
    const L = LEG.filter(l => okKernZ(l.z, f));
    const gef = L.filter(l => l.f >= 0 && inPer(l.f, f));
    const cohort = L.filter(l => l.z >= 0 && inPer(Z[l.z].s, f));
    const nogOp = cohort.filter(l => l.f < 0);
    const som = a => a.reduce((x, l) => x + l.b, 0);
    const perType = {};
    cohort.forEach(l => { const c = Z[l.z].code; const o = perType[c] || (perType[c] = { berekend: 0, opgelegd: 0, nogOp: 0 }); o.berekend += l.b; if (l.f >= 0) o.opgelegd += l.b; else o.nogOp += l.b; });
    return { gefactureerd: som(gef), berekend: som(cohort), opgelegdCohort: som(cohort.filter(l => l.f >= 0)), nogOpTeLeggen: som(nogOp), nogOpAantal: nogOp.length,
      perMaand: Array.from({ length: 12 }, (_, m) => som(gef.filter(l => l.fm === m))), perType };
  }
  // overlappende evenementen binnen afstand (meters), niet-geweigerde, die het jaar raken
  function conflicten(f, afstand) {
    afstand = afstand || 250;
    const jaarStart = Date.UTC(f.jaar, 0, 1) / 864e5 - Date.UTC(2020, 0, 1) / 864e5, jaarEind = jaarStart + (Date.UTC(f.jaar + 1, 0, 1) - Date.UTC(f.jaar, 0, 1)) / 864e5 - 1;
    const E = EV.filter(e => e.status !== 'Geweigerd' && e.lat != null && e.van >= 0 && e.tot >= 0 && (!f.alleJaren ? (e.van <= jaarEind && e.tot >= jaarStart) : true));
    const R = Math.PI / 180, out = [];
    for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
      const a = E[i], b = E[j];
      if (a.van > b.tot || b.van > a.tot) continue;
      const s1 = Math.sin((b.lat - a.lat) * R / 2), s2 = Math.sin((b.lon - a.lon) * R / 2);
      const d = 6371000 * 2 * Math.asin(Math.sqrt(s1 * s1 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * s2 * s2));
      if (d <= afstand) { const [p, q] = a.z < b.z ? [a, b] : [b, a]; out.push({ a: p, b: q, d: Math.round(d), toetsen: p.status === 'In behandeling' || q.status === 'In behandeling' }); }
    }
    return out.filter(c => !f.kern || c.a.kern === f.kern || c.b.kern === f.kern).sort((x, y) => (y.toetsen - x.toetsen) || (x.a.van - y.a.van));
  }
  function evenementen(f) {
    const E = EV.filter(e => e.ay === f.jaar && okKern(e.kern, f));
    const c = conflicten(f);
    return { aantal: E.length, bezoekers: E.reduce((a, e) => a + e.bez, 0), conflicten: c, toetsen: c.filter(x => x.toetsen).length,
      perMaand: perMaand(E, e => e.am), perType: telBy(E, e => e.type), lijst: E.slice().sort((a, b) => a.a - b.a) };
  }
  function instroomPerMaand(f) {
    const doms = ['Vergunningen', 'Toezicht en handhaving', 'Evenementen'];
    return doms.map(dm => ({ naam: dm, waarden: Array.from({ length: 12 }, (_, m) => Z.filter(z => z.sy === f.jaar && z.sm === m && z.dom === dm && okKern(z.kern, f)).length) }));
  }
  function aanvragenPerMaand(f) { return Array.from({ length: 12 }, (_, m) => Z.filter(z => z.code === 'OV-REG' && z.sy === f.jaar && z.sm === m && okKern(z.kern, f)).length); }
  function activiteiten(f) { return telBy(ACT.filter(a => a.y === f.jaar && okKernZ(a.z, f)), a => a.jv); }

  // ---- jaarverslag (producttabel) en VNG-monitor
  const PLAN = D.planning || {};
  const JV_ACT = ['Technische bouwactiviteit', 'Omgevingsplanactiviteit bouwen', 'Buitenplanse omgevingsplanactiviteit', 'Kapactiviteit', 'Aanlegactiviteit', 'Uitwegactiviteit', 'Omgevingsplanactiviteit monument/erfgoed', 'Rijksmonumentenactiviteit'];
  const JV_TZ = ['Toezicht bouwtechnische activiteit', 'Toezicht omgevingsplanactiviteit bouwen', 'Toezicht bouwveiligheidsplan', 'Toezicht kapactiviteit', 'Toezicht aanlegactiviteit', 'Toezicht uitwegactiviteit', 'Toezicht monumentactiviteit', 'Toezicht rijksmonument', 'Toezicht evenement', 'Toezicht Wabo-vergunning'];
  function jaarverslag(f) {
    const act = activiteiten(f); const I = ins(f); const s = new Set(I.map(r => r.i));
    const san = n => SAN.filter(x => s.has(x.ins.i) && x.sanctie === n).length;
    const bes = g => BES.filter(b => inPer(b.d, f) && okKernZ(b.z, f) && b.groep === g).length;
    const zt = c => zaken(f, [c]).length;
    const rows = [];
    const add = (h, p, v) => rows.push({ hoofdstuk: h, product: p, planning: (PLAN[f.jaar] && PLAN[f.jaar][p] != null) ? PLAN[f.jaar][p] : null, realisatie: v });
    JV_ACT.forEach(p => add('1.2 Vergunningverlening', p, act[p] || 0));
    add('1.2 Vergunningverlening', 'Melding brandveilig gebruik', zt('MELD-BG'));
    add('1.2 Vergunningverlening', 'Conceptverzoek (met oordeel)', zaken(f, ['CONCEPT']).filter(z => z.res === 'Akkoord' || z.res === 'Niet akkoord').length);
    add('1.3 Wet kwaliteitsborging', 'Bouwmelding Wkb', zt('WKB-BM'));
    add('1.3 Wet kwaliteitsborging', 'Gereedmelding Wkb', zt('WKB-GM'));
    JV_TZ.forEach(p => add('1.4 Toezicht', p, I.filter(r => r.typ === p).length));
    add('1.5 Handhaving', 'Behandelen melding', zt('HH-MELD')); add('1.5 Handhaving', 'Handhavingsverzoek', zt('HH-VERZ'));
    add('1.5 Handhaving', 'Handhavingszaken', zt('HH-ZAAK')); add('1.5 Handhaving', 'Legalisatieonderzoek', zt('HH-LEG'));
    add('1.5 Handhaving', 'Waarschuwingsbrief', san('Waarschuwingsbrief')); add('1.5 Handhaving', 'Vooraanschrijving', san('Vooraanschrijving'));
    add('1.5 Handhaving', 'Behandeling zienswijze', ZW.filter(x => inPer(x.d, f) && okKernZ(x.z, f)).length);
    add('1.5 Handhaving', 'Handhavingsbesluit', bes('Handhavingsbesluit')); add('1.5 Handhaving', 'Verbeurdverklaring', bes('Verbeurdverklaring'));
    add('1.5 Handhaving', 'Invorderingsbesluit', bes('Invorderingsbesluit'));
    add('1.5 Handhaving', 'Beëindigde overtredingen', zaken(f, ['HH-MELD', 'HH-ZAAK'], true).filter(z => z.res === 'Overtreding beëindigd').length);
    add('1.6 APV en bijzondere wetten', 'Evenementenvergunning', zt('APV-EVV')); add('1.6 APV en bijzondere wetten', 'Melding evenement', zt('APV-EVM'));
    const vorig = f.jaar > 2021 ? jaarverslagRaw(Object.assign({}, f, { jaar: f.jaar - 1 })) : null;
    rows.forEach((r, i) => { r.vorigJaar = vorig ? vorig[i] : null; });
    return rows;
  }
  let _jvBusy = false;
  function jaarverslagRaw(f) { if (_jvBusy) return null; _jvBusy = true; try { return jaarverslag(f).map(r => r.realisatie); } finally { _jvBusy = false; } }
  const VNG_OV = ['OV-REG', 'OV-WABO', 'OV-UIT', 'APV-EVV'], VNG_HH = ['HH-MELD', 'HH-VERZ'];
  function vng(f) {
    const I = ins(f); const s = new Set(I.map(r => r.i));
    const insG = g => I.filter(r => g.includes(codeVanZaak(r.z))).length;
    const sanG = g => SAN.filter(x => s.has(x.ins.i) && g.includes(codeVanZaak(x.ins.z))).length;
    const ov = zaken(f, OV); const af = zaken(f, OV, true);
    return [
      [1, 'Vergunningverlening', 'Ontvangen meldingen (brandveilig gebruik, bouw- en gereedmelding Wkb)', zaken(f, ['MELD-BG', 'WKB-BM', 'WKB-GM']).length],
      [2, 'Vergunningverlening', 'Waarvan melding bouwactiviteit', zaken(f, ['WKB-BM']).length],
      [3, 'Vergunningverlening', 'Waarvan gereedmelding', zaken(f, ['WKB-GM']).length],
      [4, 'Vergunningverlening', 'Verzoeken tot vooroverleg', zaken(f, ['CONCEPT']).length],
      [5, 'Vergunningverlening', 'Uitgevoerde vooroverlegafspraken (met oordeel)', zaken(f, ['CONCEPT']).filter(z => z.res === 'Akkoord' || z.res === 'Niet akkoord').length],
      [6, 'Vergunningverlening', 'Ontvangen vergunningaanvragen', ov.length],
      [7, 'Vergunningverlening', 'Ingetrokken door initiatiefnemer', ov.filter(z => z.res === 'Ingetrokken door aanvrager').length],
      [8, 'Vergunningverlening', 'Afgewezen', ov.filter(z => z.res === 'Geweigerd').length],
      [9, 'Vergunningverlening', 'Behandeld als BOPA (activiteiten)', ACT.filter(a => inPer(a.d, f) && okKernZ(a.z, f) && a.jv === 'Buitenplanse omgevingsplanactiviteit').length],
      [10, 'Vergunningverlening', 'Verleend binnen de wettelijke termijn (op datum afhandeling)', af.filter(z => z.res === 'Verleend' && z.bt === 1).length],
      [11, 'Vergunningverlening', 'Verleend buiten de wettelijke termijn (op datum afhandeling)', af.filter(z => z.res === 'Verleend' && z.bt === 0).length],
      [12, 'Vergunningverlening', 'Bezwaar ingesteld', zaken(f, ['BZ-OV']).length],
      [14, 'Toezicht en handhaving', 'Inspecties op meldingen (melding of handhavingsverzoek)', insG(VNG_HH)],
      [15, 'Toezicht en handhaving', 'Inspecties op vergunningen', insG(VNG_OV)],
      [16, 'Toezicht en handhaving', 'Handhavingsacties op meldingen (sanctiestappen)', sanG(VNG_HH)],
      [17, 'Toezicht en handhaving', 'Handhavingsacties op vergunningen (sanctiestappen)', sanG(VNG_OV)],
      [19, 'Toezicht en handhaving', 'Verbeurde dwangsommen', BES.filter(b => inPer(b.d, f) && okKernZ(b.z, f) && b.groep === 'Verbeurdverklaring').length],
      [20, 'Wkb', 'Initiatieven onder de Wkb (bouwmeldingen)', zaken(f, ['WKB-BM']).length],
      [22, 'Wkb', 'Handhavingsverzoeken en klachten van derden', zaken(f, ['HH-MELD', 'HH-VERZ']).length],
    ];
  }
  function zakenlijst(f) {
    return Z.filter(z => z.sy === f.jaar && okKern(z.kern, f) && (!f.domein || z.dom === f.domein))
      .map(z => ({ nr: z.nr, code: z.code, oms: z.oms, dom: z.dom, kern: z.kern, start: z.s, eind: z.e, uiterlijk: z.u, status: z.open ? 'Open' : 'Afgehandeld', res: z.res, dlt: z.dlt, bt: z.bt }));
  }

  // ---- hulpjes
  function telBy(a, k) { const o = {}; a.forEach(x => { const v = k(x); o[v] = (o[v] || 0) + 1; }); return o; }
  function groepeer(a, k, agg) { const g = {}; a.forEach(x => { const v = k(x); (g[v] = g[v] || []).push(x); }); const o = {}; Object.keys(g).forEach(v => o[v] = agg(g[v])); return o; }
  function perMaand(a, m) { const o = Array(12).fill(0); a.forEach(x => { const v = m(x); if (v >= 0) o[v]++; }); return o; }
  const jaren = [...new Set(Z.map(z => z.sy))].filter(y => y > 0).sort();
  return { PEIL, fmtD, jaren, kernen: LK.kern.slice().sort(), Z, EV, INS, CON, LEG, BES, SAN, vergunningen, toezicht, werkvoorraad, leges, evenementen, conflicten, instroomPerMaand, aanvragenPerMaand, activiteiten, jaarverslag, vng, zakenlijst, Y, M };
}
if (typeof module !== 'undefined') module.exports = { maakModel };

const SETS = window.__SETS;
const CODES = Object.keys(SETS);
let DATA = SETS[CODES[0]], MD = maakModel(DATA);
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = n => n == null || !isFinite(n) ? '–' : Math.round(n).toLocaleString('nl-NL');
const eur = n => n == null ? '–' : '€ ' + Math.round(n).toLocaleString('nl-NL');
const pc = n => n == null || !isFinite(n) ? '–' : (n * 100).toFixed(1).replace('.', ',') + '%';
const MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
let PEILTXT = MD.fmtD(MD.PEIL);
const store = {
  get(k, d) { try { const v = localStorage.getItem('vthv-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('vthv-' + k, JSON.stringify(v)); } catch (e) { } }
};
const S = { tab: store.get('tab', 'overzicht'), jaar: store.get('jaar', 2025), kern: store.get('kern', ''), domein: '', rap: store.get('rap', 'jv'), kw: 0, rapDom: '', limit: {}, exp: {} };
function kpi(l, v, d, cls) { return `<div class="kpi ${cls || ''}"><span class="l">${esc(l)}</span><b>${v}</b>${d ? `<span class="d">${d}</span>` : ''}</div>`; }
function delta(nu, toen, jaar) { if (toen == null || !toen) return ''; const x = (nu - toen) / toen; return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}% t.o.v. ${jaar}`; }

function nice(max) { if (max <= 0) return { top: 1, step: 1 }; const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))); const s = [1, 2, 2.5, 5, 10].map(m => m * p).find(v => v >= raw); return { top: Math.ceil(max / s) * s, step: s }; }
function barPath(x, y, w, h, r) { r = Math.min(r, w / 2, h); if (h <= 0) return ''; return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }
function kolommen(series, fmt, labels) {
  labels = labels || MND; fmt = fmt || nf;
  const W = 640, H = 220, L = 46, R = 8, T = 10, B = 24, pw = W - L - R, ph = H - T - B;
  const max = Math.max(...series.flatMap(s => s.values)); const { top, step } = nice(max);
  const gw = pw / labels.length, bw = Math.min(16, (gw - 8) / series.length);
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) { const y = T + ph - ph * v / top; g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" style="stroke:var(--grid)"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${esc(fmt(v))}</text>`; }
  let bars = '', hits = '';
  labels.forEach((lab, i) => {
    const x0 = L + i * gw + (gw - bw * series.length - 2 * (series.length - 1)) / 2;
    series.forEach((s, j) => { const v = s.values[i] || 0, h = ph * v / top; bars += `<path d="${barPath(x0 + j * (bw + 2), T + ph - h, bw, h, 3)}" style="fill:${s.color}"/>`; });
    g += `<text x="${L + i * gw + gw / 2}" y="${H - 6}" text-anchor="middle">${esc(lab)}</text>`;
    const tip = `<b>${esc(lab)}</b><br>` + series.map(s => `${esc(s.name)}: ${esc(fmt(s.values[i] || 0))}`).join('<br>');
    hits += `<rect x="${L + i * gw}" y="${T}" width="${gw}" height="${ph}" style="fill:transparent" data-tip="${esc(tip)}"/>`;
  });
  g += `<line x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}" style="stroke:var(--muted)"/>`;
  return `${series.length > 1 ? legenda(series) : ''}<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(', '))} per maand">${g}${bars}${hits}</svg></div>`;
}
function lijnen(series, fmt) {
  fmt = fmt || nf;
  const W = 640, H = 230, L = 40, R = 150, T = 12, B = 24, pw = W - L - R, ph = H - T - B;
  const max = Math.max(1, ...series.flatMap(s => s.values)); const { top, step } = nice(max);
  const x = i => L + pw * i / 11, y = v => T + ph - ph * v / top;
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) g += `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--grid)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
  MND.forEach((m, i) => g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${m}</text>`);
  let ln = '', lbl = '';
  const eind = series.map(s => ({ s, y: y(s.values[11] || 0) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < eind.length; i++) if (eind[i].y - eind[i - 1].y < 14) eind[i].y = eind[i - 1].y + 14;
  series.forEach(s => {
    ln += `<polyline points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}" style="fill:none;stroke:${s.color};stroke-width:2;stroke-linejoin:round"/>`;
    s.values.forEach((v, i) => ln += `<circle cx="${x(i)}" cy="${y(v)}" r="3" style="fill:${s.color};stroke:var(--panel);stroke-width:2"/>`);
  });
  eind.forEach(e => lbl += `<text x="${L + pw + 10}" y="${e.y + 4}" class="val">${esc(e.s.name)}</text>`);
  let hits = '';
  MND.forEach((m, i) => { const tip = `<b>${m} ${S.jaar}</b><br>` + series.map(s => `${esc(s.name)}: ${esc(fmt(s.values[i]))}`).join('<br>'); hits += `<rect x="${x(i) - pw / 22}" y="${T}" width="${pw / 11}" height="${ph}" style="fill:transparent" data-tip="${esc(tip)}"/>`; });
  return `${legenda(series)}<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Lijngrafiek per maand">${g}<line x1="${L}" x2="${L + pw}" y1="${T + ph}" y2="${T + ph}" style="stroke:var(--muted)"/>${ln}${lbl}${hits}</svg></div>`;
}
function legenda(series) { return `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`; }
function balken(items, fmt, kleur) {
  fmt = fmt || nf; kleur = kleur || 'var(--s1)';
  const max = Math.max(1, ...items.map(i => i[1]));
  return `<div style="display:grid;grid-template-columns:minmax(0,max-content) minmax(60px,1fr) auto;gap:6px 10px;align-items:center;font-size:.88rem">${items.map(i =>
    `<span style="overflow-wrap:anywhere">${esc(i[0])}</span><span style="height:14px;background:var(--soft);border-radius:0 3px 3px 0;overflow:hidden"><span style="display:block;height:100%;width:${(100 * i[1] / max).toFixed(1)}%;background:${i[2] || kleur};border-radius:0 3px 3px 0"></span></span><span class="num" style="text-align:right;font-weight:600">${esc(fmt(i[1]))}${i[3] ? ` <span class="muted" style="font-weight:400">${esc(i[3])}</span>` : ''}</span>`).join('')}</div>`;
}
const sorted = o => Object.entries(o).sort((a, b) => b[1] - a[1]);

const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip);
document.addEventListener('mousemove', e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (!t) { tip.hidden = true; return; }
  tip.innerHTML = t.getAttribute('data-tip'); tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14; if (y + h > innerHeight - 8) y = e.clientY - h - 14;
  tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
});
document.addEventListener('mouseleave', () => tip.hidden = true);

const T = { sec: "mee" }; const L = {};
let ZX, NR2I, ID2I;
function indexeer() { ZX = DATA.zaken.map(z => ({ buurt: DATA.lk.buurt[z[8]], id: String(z[9]), lat: z[10], lon: z[11] })); NR2I = new Map(DATA.zaken.map((z, i) => [z[0], i])); ID2I = new Map(ZX.map((z, i) => [z.id, i])); }
indexeer();
const dagNr = s => { if (!s) return -1; const d = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); return Math.round((d - Date.UTC(2020, 0, 1)) / 864e5); };
const fd = s => s ? MD.fmtD(dagNr(s)) : '';
function laadPaneel(tekst) { return `<div class="laden" role="status"><span class="spin" aria-hidden="true"></span>${esc(tekst)}</div>`; }
const kleurSchaal = (v, max) => { if (!v) return 'var(--soft)'; const s = [12, 24, 38, 54, 72, 92]; const i = Math.min(5, Math.floor(6 * v / (max + 1e-9))); return `color-mix(in srgb, var(--s1) ${s[i]}%, var(--panel))`; };

function kaartProj(W) {
  const K = DATA.kaart, [la0, lo0, la1, lo1] = K.bbox, c = Math.cos((la0 + la1) / 2 * Math.PI / 180);
  const sx = W / ((lo1 - lo0) * c), H = Math.round((la1 - la0) * sx);
  const P = (la, lo) => [((lo - lo0) * c * sx).toFixed(1), ((la1 - la) * sx).toFixed(1)];
  const pad = r => 'M' + r.map(p => P(p[0], p[1]).join(',')).join('L');
  return { W, H, P, pad };
}
function straten(pr) { return DATA.kaart.straten.map(r => `<path d="${pr.pad(r)}" style="fill:none;stroke:var(--line);stroke-width:.7"/>`).join(''); }

const sum = a => a.reduce((x, y) => x + y, 0), mean = a => a.length ? sum(a) / a.length : 0;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
function meter(p, kl) { return `<span class="meter"><i style="width:${Math.max(0, Math.min(100, p * 100)).toFixed(1)}%;background:${kl}"></i></span>`; }

// Live: een vraag wordt een uitgebreid dashboard. Claude maakt een specificatie (bron, maat, indeling, filters, visual),
// de pagina rekent alles zelf uit. Bronnen: zaken, controles, overtredingen, sancties, besluiten, leges en evenementen.
const LIVE = { q: '', busy: false, spec: null, ruw: null, res: [], modus: '', fout: '', duiding: '', duidBusy: false, ctl: null, hist: [], start: 0 };
let SAMPLE;
(async () => { try { SAMPLE = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('sample') : null; } catch (e) { SAMPLE = null; } if (T.sec === 'live') renderStudio(); })();

// ---------------- bronnen en hun velden
const zk = i => i >= 0 ? MD.Z[i] : null;
const termijnVan = z => !z ? 'Onbekend' : z.open ? (z.u >= 0 && z.u < MD.PEIL ? 'Open, over termijn' : 'Open') : z.u < 0 ? 'Geen termijn' : z.bt === 1 ? 'Binnen termijn' : 'Buiten termijn';
function basis(z, d) {
  const x = z ? ZX[z.i] : null;
  return { d, z: z ? z.i : -1, nr: z ? z.nr : '', kern: z ? z.kern : 'Zonder zaak', buurt: x ? x.buurt : 'Zonder zaak', lat: x ? x.lat : null, lon: x ? x.lon : null, type: z ? z.oms : 'Zonder zaak', code: z ? z.code : '', res: z ? (z.open ? 'In behandeling' : z.res || 'Onbekend') : '', status: z ? (z.open ? 'Open' : 'Afgehandeld') : '', termijn: termijnVan(z) };
}
const LBRON = {
  zaken: { l: 'Zaken', tabel: '', datum: 'startdatum', rec: () => MD.Z.map(z => Object.assign(basis(z, z.s), { doorlooptijd: z.dlt, dagen_open: z.open ? MD.PEIL - z.s : null, bt: z.bt, label: z.nr + ' · ' + z.oms })) },
  controles: { l: 'Controles', tabel: '', datum: 'inspectiedatum', rec: () => MD.INS.map(r => Object.assign(basis(zk(r.z), r.d), { onderwerp: r.ond, inspectietype: r.typ, neg: r.neg, label: r.typ + ' · ' + r.ond })) },
  overtredingen: { l: 'Overtredingen', tabel: '', datum: 'inspectiedatum', rec: () => MD.CON.map(c => Object.assign(basis(zk(c.ins.z), c.ins.d), { thema: c.thema, gevolg: c.gevolg || 'Geen gevolg vastgelegd', onderwerp: c.ins.ond, label: c.thema + ' · ' + (c.gevolg || 'geen gevolg') })) },
  sancties: { l: 'Sancties', tabel: '', datum: 'inspectiedatum', rec: () => MD.SAN.map(s => Object.assign(basis(zk(s.ins.z), s.ins.d), { sanctie: s.sanctie, onderwerp: s.ins.ond, label: s.sanctie + ' · ' + s.ins.ond })) },
  besluiten: { l: 'Besluiten', tabel: '', datum: 'besluitdatum', rec: () => MD.BES.map(b => Object.assign(basis(zk(b.z), b.d), { besluittype: b.groep, label: b.groep })) },
  leges: { l: 'Legesregels', tabel: '', datum: 'factuurdatum', rec: () => MD.LEG.filter(l => l.f >= 0).map(l => Object.assign(basis(zk(l.z), l.f), { bedrag: l.b, label: eur(l.b) })) },
  evenementen: { l: 'Evenementen', tabel: '', datum: 'aanvangsdatum', rec: () => MD.EV.map(e => { const z = zk(e.z); return Object.assign(basis(z, e.a), { evenementtype: e.type, naam: e.naam, locatie: e.loc, bezoekers: e.bez, duur: e.b >= e.a ? e.b - e.a + 1 : 1, risico: e.risico ? 'Risicoklasse ' + e.risico : 'Onbekend', status: e.status, lat: e.lat, lon: e.lon, label: e.naam + ' · ' + e.type }); }) },
};
const VELDEN = { doorlooptijd: ['zaken', 'dagen', 'Doorlooptijd (dagen)'], dagen_open: ['zaken', 'dagen', 'Dagen open'], bedrag: ['leges', 'eur', 'Bedrag'], bezoekers: ['evenementen', 'n', 'Bezoekers'], duur: ['evenementen', 'dagen', 'Duur (dagen)'] };
const VOORWAARDEN = {
  binnen_termijn: ['zaken', 'binnen de termijn', r => r.bt === 1, r => r.bt === 0 || r.bt === 1],
  over_termijn: ['zaken', 'open en over de termijn', r => r.termijn === 'Open, over termijn', () => true],
  open: ['zaken', 'nog open', r => r.status === 'Open', () => true],
  verleend: ['zaken', 'verleend', r => r.res === 'Verleend', r => r.status === 'Afgehandeld'],
  geweigerd: ['zaken', 'geweigerd', r => r.res === 'Geweigerd', r => r.status === 'Afgehandeld'],
  met_overtreding: ['controles', 'met een overtreding', r => r.neg > 0, () => true],
  handhavingstraject: ['overtredingen', 'met een handhavingstraject', r => /Handhaving|Direct/.test(r.gevolg), () => true],
};
const DIMS = {
  geen: ['totaal', () => 'Totaal'], maand: ['per maand', r => MD.M(r.d)], kwartaal: ['per kwartaal', r => 'K' + (Math.floor(MD.M(r.d) / 3) + 1)], jaar: ['per jaar', r => String(MD.Y(r.d))],
  week: ['per week', r => 'wk ' + String(isoWeek(r.d)).padStart(2, '0')], weekdag: ['per weekdag', r => WD[(new Date(Date.UTC(2020, 0, 1 + r.d)).getUTCDay() + 6) % 7]], datum: ['per dag', r => isoDag(r.d)],
  wijk: ['per wijk', r => r.kern], buurt: ['per buurt', r => r.buurt], zaaktype: ['per zaaktype', r => r.type], resultaat: ['per resultaat', r => r.res || 'Onbekend'],
  status: ['open of afgehandeld', r => r.status || 'Onbekend'], termijn: ['per termijnstatus', r => r.termijn],
  onderwerp: ['per onderwerp', r => r.onderwerp || 'Onbekend'], inspectietype: ['per inspectietype', r => r.inspectietype || 'Onbekend'], thema: ['per thema', r => r.thema || 'Onbekend'], gevolg: ['per gevolg', r => r.gevolg || 'Onbekend'],
  sanctie: ['per sanctie', r => r.sanctie || 'Onbekend'], besluittype: ['per besluittype', r => r.besluittype || 'Onbekend'], evenementtype: ['per evenementtype', r => r.evenementtype || 'Onbekend'], risico: ['per risicoklasse', r => r.risico || 'Onbekend'],
  evenement: ['per evenement', r => r.naam || r.label],
};
const WD = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const DIM_BRON = { onderwerp: ['controles', 'overtredingen', 'sancties'], inspectietype: ['controles'], thema: ['overtredingen'], gevolg: ['overtredingen'], sanctie: ['sancties'], besluittype: ['besluiten'], evenementtype: ['evenementen'], risico: ['evenementen'], evenement: ['evenementen'] };
const TYPES = ['kpi', 'lijn', 'kolom', 'gestapeld', 'balk', 'tabel', 'kaart', 'heatmap', 'lijst'];
const TIJD = ['maand', 'kwartaal', 'jaar', 'week', 'weekdag', 'datum'];
function isoWeek(d) { const t = new Date(Date.UTC(2020, 0, 1 + d)); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3); const f = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7); }
function isoDag(d) { return d < 0 ? '' : new Date(Date.UTC(2020, 0, 1 + d)).toISOString().slice(0, 10); }
const REC = {};
function records(bron) { const k = DATA.code + '|' + bron; return REC[k] || (REC[k] = LBRON[bron].rec()); }

// ---------------- specificatie opschonen
function standaardJaar() { const j = MD.Y(MD.PEIL); return MD.jaren.includes(j - 1) ? j - 1 : j; }
const lijstVan = x => (Array.isArray(x) ? x : x ? [x] : []).map(String).filter(Boolean);
function zoekIn(waarde, opties) { const w = String(waarde).toLowerCase().trim(); if (!w) return null; return opties.find(o => o.toLowerCase() === w) || opties.find(o => o.toLowerCase().includes(w) || w.includes(o.toLowerCase().replace(/^wijk \d+ /, ''))) || null; }
function opties(bron, sleutel) { return [...new Set(records(bron).map(r => r[sleutel]).filter(Boolean))].sort(); }
function schoonFilters(f, bron) {
  f = f || {};
  const out = {};
  out.jaar = f.jaar === 'alle' || f.jaar === null ? 'alle' : MD.jaren.includes(+f.jaar) ? +f.jaar : undefined;
  if (f.datum_van && dagNr(String(f.datum_van)) >= 0) out.van = dagNr(String(f.datum_van));
  if (f.datum_tot && dagNr(String(f.datum_tot)) >= 0) out.tot = dagNr(String(f.datum_tot));
  out.maanden = lijstVan(f.maanden).map(Number).filter(m => m >= 1 && m <= 12);
  out.wijken = lijstVan(f.wijken || f.wijk).map(w => zoekIn(w, MD.kernen)).filter(Boolean);
  out.buurten = lijstVan(f.buurten || f.buurt).map(b => zoekIn(b, DATA.kaart.buurtvlakken.map(x => x.naam))).filter(Boolean);
  out.zaaktypen = lijstVan(f.zaaktypen).filter(c => DATA.typeOms[c]);
  const sub = (k, s) => { const o = opties(bron, s); return o.length ? lijstVan(f[k]).map(x => zoekIn(x, o)).filter(Boolean) : []; };
  out.evenementtypen = bron === 'evenementen' ? sub('evenementtypen', 'evenementtype') : [];
  out.onderwerpen = ['controles', 'overtredingen', 'sancties'].includes(bron) ? sub('onderwerpen', 'onderwerp') : [];
  out.themas = bron === 'overtredingen' ? sub('themas', 'thema') : [];
  out.resultaten = lijstVan(f.resultaten).map(x => zoekIn(x, opties(bron, 'res'))).filter(Boolean);
  out.status = /open/i.test(f.status || '') ? 'Open' : /afgehandeld|gesloten/i.test(f.status || '') ? 'Afgehandeld' : '';
  out.termijn = /over|buiten/i.test(f.termijn || '') ? 'over' : /binnen/i.test(f.termijn || '') ? 'binnen' : '';
  out.zoek = String(f.zoek || '').trim().slice(0, 40);
  return out;
}
function schoonVisual(v, glob) {
  v = v || {};
  const bron = LBRON[v.bron] ? v.bron : 'zaken';
  let maat = ['aantal', 'som', 'gemiddelde', 'mediaan', 'percentage'].includes(v.maat) ? v.maat : 'aantal';
  let veld = VELDEN[v.veld] && VELDEN[v.veld][0] === bron ? v.veld : null;
  let voorwaarde = VOORWAARDEN[v.voorwaarde] && VOORWAARDEN[v.voorwaarde][0] === bron ? v.voorwaarde : null;
  if (['som', 'gemiddelde', 'mediaan'].includes(maat) && !veld) { veld = Object.keys(VELDEN).find(k => VELDEN[k][0] === bron) || null; if (!veld) maat = 'aantal'; }
  if (maat === 'percentage' && !voorwaarde) { voorwaarde = Object.keys(VOORWAARDEN).find(k => VOORWAARDEN[k][0] === bron) || null; if (!voorwaarde) maat = 'aantal'; }
  const dimOk = d => DIMS[d] && (!DIM_BRON[d] || DIM_BRON[d].includes(bron));
  let dim = dimOk(v.dimensie) ? v.dimensie : 'geen';
  let splits = dimOk(v.splits_op) && v.splits_op !== dim && v.splits_op !== 'geen' ? v.splits_op : null;
  let type = TYPES.includes(v.type) ? v.type : dim === 'geen' ? 'kpi' : TIJD.includes(dim) ? 'kolom' : 'balk';
  if (type === 'kpi') { dim = 'geen'; splits = null; }
  if (dim === 'geen' && !['kpi', 'kaart', 'lijst'].includes(type)) type = 'kpi';
  if (type === 'lijn' && dim !== 'maand') type = 'kolom';
  if ((type === 'gestapeld' || type === 'heatmap') && !splits) type = TIJD.includes(dim) ? 'kolom' : 'balk';
  if (type === 'kaart' && !['buurt', 'wijk'].includes(dim)) { dim = 'geen'; }
  const filters = schoonFilters(Object.assign({}, glob || {}, v.filters || {}), bron);
  if (filters.jaar === undefined) filters.jaar = (dim === 'jaar' || filters.van != null || filters.tot != null || filters.zoek) ? 'alle' : standaardJaar();
  return { titel: String(v.titel || LBRON[bron].l).slice(0, 80), bron, maat, veld, voorwaarde, dimensie: dim, splits_op: splits, type, filters, vergelijk_vorig_jaar: !!v.vergelijk_vorig_jaar && filters.jaar !== 'alle', top: Math.max(3, Math.min(30, +v.top || (type === 'lijst' ? 15 : 12))), breed: (!!v.breed && type !== 'kaart') || ['heatmap', 'lijst'].includes(type) || ['datum', 'week'].includes(dim), uitleg: String(v.uitleg || '').slice(0, 220) };
}
function schoonSpec(s) {
  s = s || {};
  const out = { samenvatting: String(s.samenvatting || ''), kan_niet: s.kan_niet ? String(s.kan_niet) : '', visuals: (s.visuals || []).slice(0, 8).map(v => schoonVisual(v, s.filters)), vervolgvragen: (s.vervolgvragen || []).slice(0, 3).map(String), inzichten: (s.inzichten || []).slice(0, 3).map(String) };
  if (!out.visuals.length && !out.kan_niet) out.kan_niet = 'Deze vraag past niet op de gegevens die in de dataset zitten.';
  return out;
}

// ---------------- rekenen
function filterRecs(v, jaarOverride) {
  const F = v.filters, jaar = jaarOverride != null ? jaarOverride : F.jaar, zq = F.zoek.toLowerCase();
  return records(v.bron).filter(r => {
    if (r.d < 0 && v.bron !== 'zaken') return false;
    if (jaar !== 'alle' && MD.Y(r.d) !== jaar) return false;
    if (F.van != null && r.d < F.van) return false; if (F.tot != null && r.d > F.tot) return false;
    if (F.maanden.length && !F.maanden.includes(MD.M(r.d) + 1)) return false;
    if (F.wijken.length && !F.wijken.includes(r.kern)) return false;
    if (F.buurten.length && !F.buurten.includes(r.buurt)) return false;
    if (F.zaaktypen.length && !F.zaaktypen.includes(r.code)) return false;
    if (F.evenementtypen.length && !F.evenementtypen.includes(r.evenementtype)) return false;
    if (F.onderwerpen.length && !F.onderwerpen.includes(r.onderwerp)) return false;
    if (F.themas.length && !F.themas.includes(r.thema)) return false;
    if (F.resultaten.length && !F.resultaten.includes(r.res)) return false;
    if (F.status && r.status !== F.status && !(F.status === 'Open' && /behandeling/i.test(r.status))) return false;
    if (F.termijn === 'over' && !/over|buiten/i.test(r.termijn)) return false;
    if (F.termijn === 'binnen' && r.termijn !== 'Binnen termijn') return false;
    if (zq && ![r.label, r.naam, r.locatie, r.type, r.buurt, r.kern].some(x => x && String(x).toLowerCase().includes(zq))) return false;
    return true;
  });
}
function aggregeer(v, rs) {
  if (v.maat === 'aantal') return rs.length;
  if (v.maat === 'percentage') { const [, , teller, noemer] = VOORWAARDEN[v.voorwaarde]; const n = rs.filter(noemer); return n.length ? n.filter(teller).length / n.length : null; }
  const w = rs.map(r => r[v.veld]).filter(x => x != null && isFinite(x));
  if (!w.length) return v.maat === 'som' ? 0 : null;
  if (v.maat === 'som') return w.reduce((a, b) => a + b, 0);
  if (v.maat === 'gemiddelde') return w.reduce((a, b) => a + b, 0) / w.length;
  return median(w);
}
function fmtVoor(v) {
  if (v.maat === 'percentage') return pc;
  if (v.maat === 'aantal') return nf;
  const e = VELDEN[v.veld][1];
  return e === 'eur' ? (x => x == null ? '–' : x >= 1e5 ? kE(x) : eur(x)) : e === 'dagen' ? (x => x == null ? '–' : (v.maat === 'som' ? nf(x) : Math.round(x)) + ' d') : nf;
}
function maatNaam(v) {
  const b = LBRON[v.bron].l.toLowerCase();
  if (v.maat === 'aantal') return 'Aantal ' + b;
  if (v.maat === 'percentage') return '% ' + b + ' ' + VOORWAARDEN[v.voorwaarde][1];
  return { som: 'Totaal', gemiddelde: 'Gemiddelde', mediaan: 'Mediaan' }[v.maat] + ' ' + VELDEN[v.veld][2].toLowerCase();
}
function ordenen(dim, keys) {
  if (dim === 'maand') return keys.map(Number).sort((a, b) => a - b);
  if (['jaar', 'kwartaal', 'week', 'datum'].includes(dim)) return keys.sort();
  if (dim === 'weekdag') return WD.filter(d => keys.includes(d));
  return keys;
}
function berekenVisual(v) {
  const rs = filterRecs(v), fmt = fmtVoor(v), uit = { rs, fmt, totaal: aggregeer(v, rs), n: rs.length, labels: [], series: [], vorig: null, matrix: null };
  if (v.vergelijk_vorig_jaar && v.filters.jaar !== 'alle' && MD.jaren.includes(v.filters.jaar - 1)) { uit.vorigRs = filterRecs(v, v.filters.jaar - 1); uit.vorig = aggregeer(v, uit.vorigRs); }
  if (v.dimensie === 'geen') return uit;
  const kd = DIMS[v.dimensie][1];
  const groep = (lijst, key) => { const g = new Map(); lijst.forEach(r => { const k = key(r); if (k === '' || k == null || (typeof k === 'number' && k < 0)) return; if (!g.has(k)) g.set(k, []); g.get(k).push(r); }); return g; };
  const G = groep(rs, kd);
  let keys = [...G.keys()];
  if (TIJD.includes(v.dimensie)) {
    if (v.dimensie === 'maand') keys = [...Array(12).keys()];
    keys = ordenen(v.dimensie, keys);
  } else {
    keys = keys.map(k => [k, aggregeer(v, G.get(k)), G.get(k).length]).filter(x => x[1] != null && (v.maat !== 'percentage' || x[2] >= 5)).sort((a, b) => b[1] - a[1]).slice(0, v.top).map(x => x[0]);
  }
  uit.labels = keys.map(k => v.dimensie === 'maand' ? MND[k] : String(k));
  if (v.splits_op) {
    const ks = DIMS[v.splits_op][1], S2 = groep(rs, ks);
    let sk = ordenen(v.splits_op, [...S2.keys()]);
    if (!TIJD.includes(v.splits_op)) sk = sk.sort((a, b) => S2.get(b).length - S2.get(a).length);
    const hoofd = sk.slice(0, v.type === 'heatmap' ? 14 : 6), rest = sk.slice(hoofd.length);
    const naam = k => v.splits_op === 'maand' ? MND[k] : String(k);
    uit.series = hoofd.map((k, j) => ({ name: naam(k), color: PAL[j % PAL.length], values: keys.map(x => aggregeer(v, (G.get(x) || []).filter(r => ks(r) === k)) || 0) }));
    if (rest.length && v.type !== 'heatmap' && v.maat === 'aantal') uit.series.push({ name: 'Overig', color: 'var(--muted)', values: keys.map(x => (G.get(x) || []).filter(r => rest.includes(ks(r))).length) });
    uit.matrix = true;
  } else {
    uit.series = [{ name: v.filters.jaar !== 'alle' ? String(v.filters.jaar) : maatNaam(v), color: PAL[0], values: keys.map(k => aggregeer(v, G.get(k) || []) ?? 0) }];
    if (uit.vorigRs) { const Gv = groep(uit.vorigRs, kd); uit.series.push({ name: String(v.filters.jaar - 1), color: 'var(--muted)', values: keys.map(k => aggregeer(v, Gv.get(k) || []) ?? 0) }); }
  }
  if (v.dimensie === 'maand' && v.filters.jaar === MD.Y(MD.PEIL)) { const lm = MD.M(MD.PEIL); uit.series[0].values = uit.series[0].values.map((x, i) => i > lm ? 0 : x); }
  return uit;
}
const PAL = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];

// ---------------- tekenen
function gestapeldSvg(labels, series, fmt) {
  const W = 680, H = 250, Lm = 48, R = 8, Tm = 10, B = 26, pw = W - Lm - R, ph = H - Tm - B;
  const tot = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0)), { top, step } = nice(Math.max(1, ...tot));
  const gw = pw / labels.length, bw = Math.min(34, gw * .7); let g = '', bars = '', hits = '';
  for (let v = 0; v <= top + 1e-9; v += step) { const y = Tm + ph - ph * v / top; g += `<line x1="${Lm}" x2="${W - R}" y1="${y}" y2="${y}" style="stroke:var(--grid)"/><text x="${Lm - 6}" y="${y + 4}" text-anchor="end">${esc(fmt(v))}</text>`; }
  const elke = Math.ceil(labels.length / 16);
  labels.forEach((lab, i) => {
    let y = Tm + ph; const x = Lm + i * gw + (gw - bw) / 2;
    series.forEach(s => { const h = ph * (s.values[i] || 0) / top; if (h > 0) { y -= h; bars += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" style="fill:${s.color}"/>`; } });
    if (i % elke === 0) g += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(lab.length > 8 ? lab.slice(0, 7) + '…' : lab)}</text>`;
    hits += `<rect x="${Lm + i * gw}" y="${Tm}" width="${gw}" height="${ph}" style="fill:transparent" data-tip="${esc(`<b>${lab}</b><br>` + series.filter(s => s.values[i]).map(s => `${s.name}: ${fmt(s.values[i])}`).join('<br>') + `<br><b>Totaal: ${fmt(tot[i])}</b>`)}"/>`;
  });
  return `${legenda(series)}<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gestapelde kolommen">${g}<line x1="${Lm}" x2="${W - R}" y1="${Tm + ph}" y2="${Tm + ph}" style="stroke:var(--muted)"/>${bars}${hits}</svg></div>`;
}
function kolomSvg(labels, series, fmt) {
  if (labels.length <= 14) return kolommen(series, fmt, labels.map(l => l.length > 9 ? l.slice(0, 8) + '…' : l));
  return gestapeldSvg(labels, series.slice(0, 1), fmt);
}
function heatmapHtml(v, r) {
  const max = Math.max(1e-9, ...r.series.flatMap(s => s.values));
  return `<div class="scroll"><table class="heat"><thead><tr><th>${esc(DIMS[v.dimensie][0].replace(/^per /, ''))}</th>${r.series.map(s => `<th class="r">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${r.labels.map((l, i) => `<tr><td>${esc(l)}</td>${r.series.map(s => { const x = s.values[i] || 0; return `<td class="r num" style="background:${kleurSchaal(x, max)};color:${x / max > .6 ? 'var(--accent-ink)' : 'var(--ink)'}" data-tip="${esc(`${l} · ${s.name}: ${r.fmt(x)}`)}">${x ? esc(r.fmt(x)) : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function kaartHtml(v, r) {
  const pr = kaartProj(640);
  let g = '';
  if (['buurt', 'wijk'].includes(v.dimensie)) {
    const waarde = new Map(r.labels.map((l, i) => [l, r.series[0].values[i]])), max = Math.max(1e-9, ...waarde.values());
    g = DATA.kaart.buurtvlakken.map(b => { const x = v.dimensie === 'buurt' ? waarde.get(b.naam) : waarde.get(MD.kernen.find(k => k.endsWith(b.wijk)) || b.wijk); return `<path d="${b.ringen.map(pr.pad).join('Z')}Z" style="fill:${kleurSchaal(x || 0, max)};stroke:var(--panel);stroke-width:1" data-tip="${esc(`<b>${b.naam}</b><br>${maatNaam(v)}: ${r.fmt(x || 0)}`)}"/>`; }).join('') + straten(pr);
  } else {
    const cat = v.splits_op ? DIMS[v.splits_op][1] : null, cats = cat ? [...new Set(r.rs.map(cat))].slice(0, 6) : [];
    g = DATA.kaart.buurtvlakken.map(b => `<path d="${b.ringen.map(pr.pad).join('Z')}Z" style="fill:var(--soft);stroke:var(--panel);stroke-width:1"/>`).join('') + straten(pr);
    const pts = r.rs.filter(x => x.lat != null).slice(0, 2500);
    g += pts.map(x => { const p = pr.P(x.lat, x.lon), k = cat ? cats.indexOf(cat(x)) : 0; return `<circle cx="${p[0]}" cy="${p[1]}" r="${v.bron === 'evenementen' ? 5 : 3.2}" style="fill:${k >= 0 ? PAL[k % PAL.length] : 'var(--muted)'};fill-opacity:.8;stroke:var(--panel);stroke-width:.8" data-tip="${esc(`<b>${x.label}</b><br>${x.buurt}${x.d >= 0 ? ' · ' + MD.fmtD(x.d) : ''}${x.bezoekers ? ' · ' + nf(x.bezoekers) + ' bezoekers' : ''}`)}"/>`; }).join('');
    r.legenda = cat ? legenda(cats.map((c, k) => ({ name: c, color: PAL[k % PAL.length] }))) : '';
    r.zonder = r.rs.length - pts.length;
  }
  g += DATA.kaart.kernen.map(k => { const p = pr.P(k.lat, k.lon); return `<text x="${p[0]}" y="${p[1]}" text-anchor="middle" style="font:700 11px var(--sans);fill:var(--ink);paint-order:stroke;stroke:var(--panel);stroke-width:3px;pointer-events:none">${esc(k.naam)}</text>`; }).join('');
  return `${r.legenda || ''}<div class="map"><svg viewBox="0 0 ${pr.W} ${pr.H}" role="img" aria-label="Kaart">${g}</svg></div>${r.zonder ? `<p class="small muted">${nf(r.zonder)} zonder locatie niet op de kaart.</p>` : ''}`;
}
function lijstHtml(v, r) {
  const veld = v.veld, rs = r.rs.slice().sort((a, b) => veld ? (b[veld] || 0) - (a[veld] || 0) : b.d - a.d).slice(0, v.top);
  return `<div class="scroll"><table><thead><tr><th>${v.bron === 'zaken' ? 'Zaak' : 'Omschrijving'}</th><th>Datum</th><th>Wijk / buurt</th><th>Status</th>${veld ? `<th class="r">${esc(VELDEN[veld][2])}</th>` : ''}</tr></thead><tbody>${rs.map(x => `<tr><td>${x.nr && x.z >= 0 ? `<button class="link" data-act="z360" data-nr="${esc(x.nr)}">${esc(x.nr)}</button> ` : ''}${esc(v.bron === 'zaken' ? x.type : x.label)}</td><td class="num">${x.d >= 0 ? MD.fmtD(x.d) : ''}</td><td>${esc(x.buurt)}<span class="muted small"> · ${esc(x.kern)}</span></td><td>${esc(x.status || x.res || '')}</td>${veld ? `<td class="r num">${esc(r.fmt(x[veld]))}</td>` : ''}</tr>`).join('')}</tbody></table></div>${r.rs.length > rs.length ? `<p class="small muted">${nf(rs.length)} van ${nf(r.rs.length)}</p>` : ''}`;
}
function filterTekstV(v) {
  const F = v.filters, d = [];
  d.push(F.van != null || F.tot != null ? `${F.van != null ? MD.fmtD(F.van) : '…'} t/m ${F.tot != null ? MD.fmtD(F.tot) : '…'}` : F.jaar === 'alle' ? 'alle jaren' : String(F.jaar));
  if (F.maanden.length) d.push(F.maanden.map(m => MND[m - 1]).join(', '));
  [F.wijken, F.buurten, F.zaaktypen, F.evenementtypen, F.onderwerpen, F.themas, F.resultaten].forEach(x => { if (x.length) d.push(x.join(', ')); });
  if (F.status) d.push(F.status.toLowerCase()); if (F.termijn) d.push(F.termijn + ' termijn'); if (F.zoek) d.push('"' + F.zoek + '"');
  return d.join(' · ');
}
function tekenVisual(v, r, i) {
  let body;
  const leeg = v.dimensie !== 'geen' && (!r.series.length || r.series.every(s => s.values.every(x => !x)));
  if (v.type === 'kpi') {
    const d = r.vorig != null && r.totaal != null ? (v.maat === 'percentage' ? `${((r.totaal - r.vorig) * 100).toFixed(1).replace('.', ',')} procentpunt t.o.v. ${v.filters.jaar - 1}` : delta(r.totaal, r.vorig, v.filters.jaar - 1)) : `${nf(r.n)} ${LBRON[v.bron].l.toLowerCase()}`;
    body = `<div class="lkpi"><b>${esc(r.fmt(r.totaal))}</b><span>${esc(d)}</span></div>`;
  } else if (v.type === 'kaart') body = r.n ? kaartHtml(v, r) : '<p class="muted">Geen gegevens voor deze selectie.</p>';
  else if (v.type === 'lijst') body = r.n ? lijstHtml(v, r) : '<p class="muted">Geen gegevens voor deze selectie.</p>';
  else if (leeg) body = '<p class="muted">Geen gegevens voor deze selectie.</p>';
  else if (v.type === 'heatmap') body = heatmapHtml(v, r);
  else if (v.type === 'tabel') body = `<div class="scroll"><table><thead><tr><th>${esc(DIMS[v.dimensie][0].replace(/^per /, ''))}</th>${r.series.map(s => `<th class="r">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${r.labels.map((l, k) => `<tr><td>${esc(l)}</td>${r.series.map(s => `<td class="r num">${esc(r.fmt(s.values[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  else if (v.type === 'lijn' && v.dimensie === 'maand' && !v.splits_op) body = lijnen(r.series, r.fmt);
  else if (v.type === 'gestapeld') body = gestapeldSvg(r.labels, r.series, r.fmt);
  else if (v.type === 'balk' && !TIJD.includes(v.dimensie) && r.series.length === 1) body = balken(r.labels.map((l, k) => [l, r.series[0].values[k] || 0]), r.fmt);
  else body = kolomSvg(r.labels, r.series, r.fmt);
  return `<div class="card lv ${v.breed ? 'breed' : ''}${v.type === 'kpi' ? ' kpikaart' : ''}"><div class="head"><h2>${esc(v.titel)}<button class="ob-knop" data-act="ob" data-live="${i}" aria-label="Onderbouwing" title="Onderbouwing">i</button></h2><p>${esc(filterTekstV(v))}</p></div>${v.uitleg && v.type !== 'kpi' ? `<p class="small muted lvuitleg">${esc(v.uitleg)}</p>` : ''}${body}</div>`;
}
function liveObOnderb(v, r) {
  const B = LBRON[v.bron];
  const def = `${maatNaam(v)}${v.dimensie !== 'geen' ? ', ' + DIMS[v.dimensie][0] : ''}${v.splits_op ? ', uitgesplitst ' + DIMS[v.splits_op][0] : ''}. Telt ${B.l.toLowerCase()} op ${B.datum}.${v.maat === 'percentage' ? ' Teller: ' + VOORWAARDEN[v.voorwaarde][1] + '.' : ''}`;
  return { v: [], w: ({ kpi: 'Eén getal, met vorig jaar als dat gevraagd is.', lijn: 'Een lijn over twaalf maanden: seizoen en verschil in één beeld.', kolom: 'Kolommen per periode of groep.', gestapeld: 'Gestapelde kolommen: het totaal én de opbouw.', balk: 'Gesorteerde balken: de grootste bovenaan.', tabel: '', kaart: 'Een kaart: waar het gebeurt.', heatmap: 'Een heatmap: twee indelingen tegelijk, kleur = hoeveel.', lijst: 'Een lijst: de onderliggende zaken, aanklikbaar.' }[v.type] || '') + ` Gekozen door ${LIVE.modus === 'claude' ? 'Claude' : 'de trefwoordherkenning'}, berekend door de pagina op ${nf(r.n)} records.`, d: def, b: `${B.tabel}${v.bron !== 'zaken' ? ' → RGBZ.Zaken' : ''}`, l: v.maat === 'percentage' ? 'Groepen met minder dan 5 records zijn weggelaten.' : '' };
}

// ---------------- Claude
function catalogus() { return ""; }
function livePrompt() { return ""; }
function trefwoorden(q) {
  const t = q.toLowerCase();
  if (/\b(uur|uren|capaciteit|fte|medewerker)/.test(t)) return { kan_niet: 'Uren, capaciteit en medewerkers staan niet in CLO (aandachtspunt G09). Hieronder het dichtstbijzijnde: de werkvoorraad.', visuals: [{ titel: 'Open zaken', bron: 'zaken', type: 'kpi', filters: { status: 'open', jaar: 'alle' } }, { titel: 'Open zaken per zaaktype', bron: 'zaken', dimensie: 'zaaktype', type: 'balk', filters: { status: 'open', jaar: 'alle' } }] };
  const evt = DATA.lk.evtype.find(e => t.includes(e.toLowerCase().split(' ')[0]));
  const bron = /leges|geld|opbrengst|factu|euro/.test(t) ? 'leges' : /evenement|festival|kermis|koningsdag|braderie|markt/.test(t) ? 'evenementen' : /sanctie|stillegging|sluiting/.test(t) ? 'sancties' : /overtred/.test(t) ? 'overtredingen' : /controle|inspectie|toezicht/.test(t) ? 'controles' : /besluit/.test(t) ? 'besluiten' : 'zaken';
  const codes = /melding|klacht|overlast/.test(t) ? ['HH-MELD'] : /handhav/.test(t) ? ['HH-ZAAK', 'HH-VERZ'] : /aanvra|vergunning/.test(t) && bron === 'zaken' ? ['OV-REG', 'OV-UIT'] : [];
  const jm = t.match(/20\d\d/), f = { jaar: jm ? +jm[0] : (evt || /jaren|trend/.test(t) ? 'alle' : standaardJaar()), zaaktypen: codes, evenementtypen: evt ? [evt] : [] };
  const maat = bron === 'leges' ? { maat: 'som', veld: 'bedrag' } : /doorloop|hoe lang/.test(t) ? { maat: 'gemiddelde', veld: 'doorlooptijd' } : /termijn/.test(t) ? { maat: 'percentage', voorwaarde: 'binnen_termijn' } : /% |percent/.test(t) && bron === 'controles' ? { maat: 'percentage', voorwaarde: 'met_overtreding' } : { maat: 'aantal' };
  const naam = LBRON[bron].l;
  const vis = [Object.assign({ titel: naam, bron, type: 'kpi', filters: f }, maat), Object.assign({ titel: naam + ' per maand', bron, dimensie: 'maand', type: 'kolom', filters: f }, maat), Object.assign({ titel: naam + ' per wijk', bron, dimensie: 'wijk', type: 'balk', filters: f }, maat)];
  if (/kaart|waar|locatie|plek/.test(t) || bron === 'evenementen') vis.push({ titel: 'Op de kaart', bron, type: 'kaart', filters: f, splits_op: bron === 'evenementen' ? 'evenementtype' : 'zaaktype' });
  if (/welke|lijst|details/.test(t) || bron === 'evenementen') vis.push({ titel: 'De onderliggende ' + naam.toLowerCase(), bron, type: 'lijst', filters: f });
  return { samenvatting: `${naam} in ${DATA.naam}.`, visuals: vis, vervolgvragen: [] };
}
async function vraagLive() {
  const q = (LIVE.q || '').trim(); if (!q || LIVE.busy) return;
  LIVE.busy = true; LIVE.fout = ''; LIVE.duiding = ''; LIVE.spec = null; LIVE.res = []; LIVE.start = Date.now(); renderStudio();
  let ruw = null;
  if (SAMPLE) {
    LIVE.ctl = new AbortController();
    try { ruw = await SAMPLE.json(livePrompt(q), { modelTier: 'default', signal: LIVE.ctl.signal }); LIVE.modus = 'claude'; }
    catch (e) {
      const c = e && e.code;
      LIVE.fout = c === 'cancelled' ? 'Gestopt.' : c === 'not_granted' ? 'Claude is niet toegestaan in deze weergave. De trefwoordherkenning neemt het over.' : c === 'rate_limited' ? 'Even te veel vragen tegelijk. De trefwoordherkenning neemt het over.' : 'Claude gaf geen bruikbaar antwoord. De trefwoordherkenning neemt het over.';
      if (c === 'not_granted') SAMPLE = null;
      if (c === 'cancelled') { LIVE.busy = false; renderStudio(); return; }
    }
  }
  if (!ruw) { ruw = trefwoorden(q); LIVE.modus = 'trefwoord'; }
  LIVE.ruw = ruw; LIVE.spec = schoonSpec(ruw); LIVE.busy = false; LIVE.duur = Date.now() - LIVE.start; LIVE.galId = null;
  LIVE.hist = [q].concat(LIVE.hist.filter(x => x !== q)).slice(0, 5);
  renderStudio();
  galBewaar(q);
  if (SAMPLE && LIVE.modus === 'claude' && LIVE.res.length) duidLive();
}
async function duidLive() {
  if (!SAMPLE || !LIVE.res.length || LIVE.duidBusy) return;
  LIVE.duidBusy = true; LIVE.duiding = ''; renderStudio();
  const samen = LIVE.res.map(x => { const r = x.r; return `${x.titel} (${maatNaam(x.spec)}; ${filterTekstV(x.spec)}): totaal ${r.fmt(r.totaal)}${r.vorig != null ? ', vorig jaar ' + r.fmt(r.vorig) : ''}${r.labels.length ? '; ' + r.labels.slice(0, 15).map((l, k) => l + ' ' + r.series.slice(0, 4).map(s => r.fmt(s.values[k])).join('/')).join(', ') : ''}`; }).join('\n');
  try {
    await SAMPLE(`Je helpt een beleidsmedewerker VTH van gemeente ${DATA.naam}. Geef in maximaal 4 korte zinnen (taalniveau B1) de belangrijkste inzichten uit deze geaggregeerde cijfers, en sluit af met één concrete vervolgstap. Noem alleen wat uit de cijfers blijkt; verzin geen oorzaken. Het jaar ${MD.Y(MD.PEIL)} loopt tot ${PEILTXT}. De data is fictief.\n\nVraag: ${LIVE.q}\n\n${samen}`, { modelTier: 'default', onText: ({ text }) => { LIVE.duiding = text; const el = $('#duiding'); if (el) el.textContent = text; } });
  } catch (e) { LIVE.duiding = e && e.text ? e.text : 'Duiden lukte niet.'; }
  LIVE.duidBusy = false; renderStudio(); galDuiding();
}
function liveVoorbeelden() {
  return ['Hoeveel evenementen waren er rond Koningsdag en waar? Laat ze op de kaart zien.', 'Welke wijken hebben de meeste meldingen, per maand en per onderwerp?', 'Hoe ontwikkelt de doorlooptijd van omgevingsvergunningen zich, en welke zaken duren het langst?', 'Welke overtredingen komen het meest voor per thema en wat is het gevolg?', 'Wat ligt er open over de termijn en waar?', 'Hoeveel uur besteden we aan toezicht?'];
}
function tLive() {
  const s = LIVE.spec;
  LIVE.res = s ? s.visuals.map(v => { const r = berekenVisual(v); return { titel: v.titel, spec: v, r, ob: liveObOnderb(v, r) }; }) : [];
  const modus = SAMPLE ? '<span class="pill ok">Claude actief</span>' : SAMPLE === undefined ? '<span class="pill">Claude laden…</span>' : '<span class="pill warn">Zonder Claude</span>';
  const kpis = LIVE.res.map((x, i) => [x, i]).filter(([x]) => x.spec.type === 'kpi'), rest = LIVE.res.map((x, i) => [x, i]).filter(([x]) => x.spec.type !== 'kpi');
  const [k, box] = iK();
  return `<div class="livekop"><p class="eyebrow">Stap 7 · live</p><h1>Het voorwerk staat. Nu gaat het <em>snel</em>.${k}</h1>
    ${box('<p><b>Hoe werkt het?</b> 1. Claude maakt van de vraag een dashboardontwerp. 2. De pagina rekent zelf alle cijfers uit. 3. Elke visual heeft een i met definitie, bron en SQL.</p><p>Claude krijgt alleen de vraag en de catalogus (bronnen, maten, indelingen, wijken, zaaktypen), geen zaakgegevens. In de oplossing voor CLO zit geen AI; dit is de demo.</p>')}
    <form id="liveform" class="livebalk" autocomplete="off"><label for="liveq" class="sr">Vraag of casus</label><input id="liveq" type="text" value="${esc(LIVE.q)}" placeholder="Stel een vraag over VTH-rapportage" maxlength="300">
      ${LIVE.busy ? `<button type="button" class="btn" data-act="live-stop">Stop</button>` : `<button type="submit" class="btn primary">Maak dashboard</button>`}</form>
    <div class="chips">${liveVoorbeelden().slice(0, 3).map(q => `<button class="chip" data-act="live-vb" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <p class="livestatus">${modus} <span>${esc(DATA.naam)} · peildatum ${PEILTXT}</span>${GAL.lijst.length ? `<button class="galspring" data-act="galspring">Galerij · ${GAL.lijst.length} ↓</button>` : ''}</p></div>
  ${liveFundament()}
  ${zaalPaneel()}
  ${LIVE.busy ? `<div class="card livebezig"><div class="laden" role="status"><span class="spin" aria-hidden="true"></span><div><b>${SAMPLE ? 'Claude ontwerpt het dashboard…' : 'Vraag wordt vertaald…'}</b><span class="small muted">10 tot 40 seconden</span></div></div></div>` : ''}
  ${LIVE.fout ? `<p class="note">${esc(LIVE.fout)}</p>` : ''}
  ${s ? `<div class="liveres" id="liveres">
    <div class="tbar"><div>${galNav()}<h2>${esc(s.samenvatting || LIVE.q)}</h2><span class="livemeta">${LIVE.duur ? `<span class="stopwatch" title="Van vraag tot dashboard">⏱ ${fmtDuur(LIVE.duur)}</span>` : ''}${matchPil()}</span></div>
      <span class="livetools">${LIVE.res.length ? '<button class="btn primary" data-act="meeqr" title="QR-code: dit dashboard op je telefoon">Op je telefoon</button><button class="btn" data-act="sql-toon" title="Zo draait dit in CLO, zonder AI">SQL</button>' : ''}${SAMPLE && LIVE.res.length && !LIVE.duidBusy && !LIVE.duiding ? `<button class="btn" data-act="live-duid">Duiden</button>` : ''}</span></div>
    ${s.kan_niet ? `<div class="note"><b>Kan niet precies.</b> ${esc(s.kan_niet)}</div>` : ''}
    ${LIVE.duiding || LIVE.duidBusy ? `<div class="duiding"><b>Inzichten van Claude</b><p id="duiding">${esc(LIVE.duiding || 'Claude leest de uitkomsten…')}</p></div>` : ''}
    ${kpis.length ? `<div class="kpis livekpis">${kpis.map(([x, i]) => tekenVisual(x.spec, x.r, i)).join('')}</div>` : ''}
    ${rest.length ? `<div class="livegrid">${rest.map(([x, i]) => tekenVisual(x.spec, x.r, i)).join('')}</div>` : ''}
    ${s.vervolgvragen.length ? `<div class="chips"><span class="small muted">Vervolgvragen:</span>${s.vervolgvragen.map(q => `<button class="chip" data-act="live-vb" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : ''}</div>` : ''}
  ${galBlok()}`;
}


// VTH-dashboard: losse kijkpagina. Toont alleen het dashboard uit de link (#d-…), zonder de studio.
// Hergebruikt de rekenlogica van de studio; alle cijfers worden op de telefoon uitgerekend uit fictieve data.
function naGemeente() { indexeer(); }
const VCODES = ['GM0484', 'GM0345', 'GM0632'];
const VKA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VK = {
  maten: ['aantal', 'som', 'gemiddelde', 'mediaan', 'percentage'],
  bron: () => Object.keys(LBRON), veld: () => Object.keys(VELDEN), vw: () => Object.keys(VOORWAARDEN), dim: () => Object.keys(DIMS),
  lijsten: bron => [['wijken', MD.kernen], ['buurten', DATA.kaart.buurtvlakken.map(x => x.naam)], ['zaaktypen', Object.keys(DATA.typeOms)],
    ['evenementtypen', bron === 'evenementen' ? opties(bron, 'evenementtype') : []], ['onderwerpen', ['controles', 'overtredingen', 'sancties'].includes(bron) ? opties(bron, 'onderwerp') : []],
    ['themas', bron === 'overtredingen' ? opties(bron, 'thema') : []], ['resultaten', opties(bron, 'res')]],
};
function vDekodeerCompact(s) {
  let p = 0; const r1 = () => { const c = VKA.indexOf(s[p++]); if (c < 0) throw new Error('code'); return c; }, r2 = () => r1() * 64 + r1();
  if (r1() !== 0) throw new Error('versie');
  r1(); r2();
  const visuals = []; let vorigeF = {};
  while (p < s.length) {
    const a = r1(), b = r1(), dim = r1(), sp = r1(), vv = r1(), top = r1();
    const bron = VK.bron()[Math.floor(a / 5)], v = { bron, maat: VK.maten[a % 5], type: TYPES[b >> 2], vergelijk_vorig_jaar: !!(b & 2), breed: !!(b & 1), dimensie: VK.dim()[dim], splits_op: sp ? VK.dim()[sp - 1] : null, top,
      veld: vv >= 1 && vv <= 5 ? VK.veld()[vv - 1] : null, voorwaarde: vv >= 6 ? VK.vw()[vv - 6] : null };
    if (r1() === 1) v.filters = vorigeF;
    else {
      const mask = r2(), f = {}, L = VK.lijsten(bron);
      if (mask & 1) { const j = r1(); f.jaar = j === 0 ? 'alle' : 2000 + j; }
      if (mask & 2) { const m = r2(); f.maanden = [...Array(12).keys()].filter(i => m & 1 << i).map(i => i + 1); }
      L.forEach(([k, lijst], i) => { if (!(mask & 1 << (2 + i))) return; const n = r1(); f[k] = [...Array(n)].map(() => lijst[lijst.length > 64 ? r2() : r1()]).filter(Boolean); });
      if (mask & 1 << 9) f.status = r1() === 0 ? 'open' : 'afgehandeld';
      if (mask & 1 << 10) f.termijn = r1() === 0 ? 'over' : 'binnen';
      if (mask & 1 << 11) { const t = r1(); if (t & 1) f.datum_van = isoDag(r2()); if (t & 2) f.datum_tot = isoDag(r2()); }
      v.filters = vorigeF = f;
    }
    const schoon = schoonVisual(v, {}); const t = maatNaam(schoon) + (schoon.dimensie !== 'geen' ? ' ' + DIMS[schoon.dimensie][0] : '');
    v.titel = t.charAt(0).toUpperCase() + t.slice(1);
    visuals.push(v);
  }
  return { q: '', s: { samenvatting: 'Dashboard', visuals } };
}
function vToon(o) {
  const m = document.getElementById('vmain');
  LIVE.q = o.q || ''; LIVE.ruw = o.s || {}; LIVE.spec = schoonSpec(LIVE.ruw);
  const s = LIVE.spec;
  LIVE.res = s.visuals.map(v => { const r = berekenVisual(v); return { titel: v.titel, spec: v, r, ob: liveObOnderb(v, r) }; });
  const kpis = LIVE.res.map((x, i) => [x, i]).filter(([x]) => x.spec.type === 'kpi'), rest = LIVE.res.map((x, i) => [x, i]).filter(([x]) => x.spec.type !== 'kpi');
  document.title = (s.samenvatting || 'Dashboard') + ' · VTH-dashboard';
  m.innerHTML = `<div class="meetitel"><p class="eyebrow">${esc(DATA.naam)} · peildatum ${esc(PEILTXT)}</p><h1>${esc(s.samenvatting || 'Dashboard')}</h1>${LIVE.q ? `<p class="meeq">“${esc(LIVE.q)}”</p>` : ''}</div>
    ${s.kan_niet ? `<div class="note"><b>Kan niet precies.</b> ${esc(s.kan_niet)}</div>` : ''}
    ${kpis.length ? `<div class="kpis livekpis">${kpis.map(([x, i]) => tekenVisual(x.spec, x.r, i)).join('')}</div>` : ''}
    ${rest.length ? `<div class="livegrid">${rest.map(([x, i]) => tekenVisual(x.spec, x.r, i)).join('')}</div>` : ''}`;
}
function vFout(t) { document.getElementById('vmain').innerHTML = `<div class="meeleeg"><b>${esc(t)}</b><span>Scan de QR-code bij het dashboard op het scherm opnieuw.</span></div>`; }
// uitleg bij een visual (zonder brontabellen)
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); const dr = document.getElementById('onderb');
  if (dr && !dr.hidden && !e.target.closest('#onderb') && !(b && b.dataset.act === 'ob')) dr.hidden = true;
  if (!b) return;
  if (b.dataset.act === 'ob' && b.dataset.live != null) {
    const v = LIVE.res[+b.dataset.live]; if (!v) return; const o = v.ob;
    dr.innerHTML = `<div class="ob-kop"><p class="eyebrow">Uitleg</p><button class="btn" data-act="obdicht">Sluiten</button></div><h2>${esc(v.titel)}</h2>
      <dl class="kv ob-kv">${[['Waarom deze visual', o.w], ['Wat telt mee', o.d], ['Let op', o.l]].filter(x => x[1]).map(x => `<div><dt>${x[0]}</dt><dd>${esc(x[1])}</dd></div>`).join('')}</dl><p class="small muted">Fictieve data. De cijfers zijn op dit apparaat uitgerekend.</p>`;
    dr.hidden = false;
  } else if (b.dataset.act === 'obdicht') dr.hidden = true;
});
(async () => {
  const P = window.__PAYLOAD;
  try { vToon(P[0] === 'A' ? vDekodeerCompact(P) : window.__RIJK); } catch (e) { vFout('Dit dashboard kon niet worden geladen.'); }
})();
