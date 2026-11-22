const palettes = [
  { id: "violet", name: "Violet", hue: 268 },
  { id: "ocean", name: "Ocean", hue: 213 },
  { id: "jade", name: "Jade", hue: 164 },
  { id: "amber", name: "Amber", hue: 30 },
] as const;

export type Palette = (typeof palettes)[number]["id"];

export function readPalette(): Palette {
  const saved = localStorage.getItem("voxx-palette");
  return palettes.find(({ id }) => id === saved)?.id ?? "violet";
}

export function ThemeSettings({
  palette,
  light,
  animated,
  setPalette,
  setLight,
  setAnimated,
}: {
  palette: Palette;
  light: boolean;
  animated: boolean;
  setPalette: (palette: Palette) => void;
  setLight: (light: boolean) => void;
  setAnimated: (animated: boolean) => void;
}) {
  return (
    <section className="panel theme-settings" aria-label="Theme preferences">
      <fieldset>
        <legend>Color family</legend>
        <div className="theme-palettes">
          {palettes.map(({ id, name, hue }) => (
            <label key={id} className="theme-palette" style={{ color: `hsl(${hue}, 64%, ${light ? 34 : 76}%)` }}>
              <input type="radio" name="palette" value={id} checked={palette === id} onChange={() => setPalette(id)} />
              <span className="theme-swatch" aria-hidden="true" />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Appearance</legend>
        <div className="theme-modes">
          <label><input type="radio" name="appearance" checked={!light} onChange={() => setLight(false)} /> Dark</label>
          <label><input type="radio" name="appearance" checked={light} onChange={() => setLight(true)} /> Light</label>
        </div>
      </fieldset>
      <label className="theme-motion">
        <input type="checkbox" checked={animated} onChange={(event) => setAnimated(event.target.checked)} />
        <span>Animate gradient and particles</span>
      </label>
    </section>
  );
}
