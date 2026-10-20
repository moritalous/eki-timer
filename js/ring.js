// 楕円の路線図の幾何。角度 a は楕円の媒介変数で、中心は (0, 0)
export function ring(rx, ry) {
  const pt = a => [rx * Math.cos(a), ry * Math.sin(a)];
  const normal = a => Math.atan2(Math.sin(a) / ry, Math.cos(a) / rx);
  return {
    rx, ry, pt,
    // a0 から a1 までの弧（a1 < a0 なら反時計回り）。90度ごとに区切って描く
    arc(a0, a1) {
      const span = a1 - a0;
      if (Math.abs(span) < 1e-4) return '';
      const n = Math.ceil(Math.abs(span) / (Math.PI / 2));
      let [x, y] = pt(a0), d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
      for (let i = 1; i <= n; i++) {
        [x, y] = pt(a0 + span * i / n);
        d += ` A${rx} ${ry} 0 0 ${span > 0 ? 1 : 0} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      return d;
    },
    // 駅名を輪の外側に、放射状に置くための属性（左半分は読める向きに反転）
    label(a, gap) {
      const [x, y] = pt(a), nv = normal(a);
      const lx = (x + gap * Math.cos(nv)).toFixed(1), ly = (y + gap * Math.sin(nv)).toFixed(1);
      const deg = nv * 180 / Math.PI, right = Math.cos(nv) >= 0;
      return `x="${lx}" y="${ly}" dominant-baseline="middle" text-anchor="${right ? 'start' : 'end'}" transform="rotate(${(right ? deg : deg + 180).toFixed(1)} ${lx} ${ly})"`;
    },
  };
}

// 駅名の文字の大きさ。全駅そろえて、長い駅名だけ縮める
export const labelSize = name => Math.min(15, Math.floor(110 / name.length));

// 中身が収まる viewBox を、輪の中心が常に真ん中に来るよう上下左右対称にとる
export function fitCentered(svg, g, pad) {
  const b = g.getBBox();
  const hx = Math.max(-b.x, b.x + b.width) + pad, hy = Math.max(-b.y, b.y + b.height) + pad;
  svg.setAttribute('viewBox', `${-hx} ${-hy} ${hx * 2} ${hy * 2}`);
}
