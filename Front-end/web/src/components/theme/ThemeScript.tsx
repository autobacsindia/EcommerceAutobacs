/**
 * Applies the saved theme before the first paint.
 *
 * This has to be a blocking inline script in <head>. React cannot do it: by the
 * time a component runs, the browser has already painted, and on a dark-theme
 * visitor that means a white flash on every single navigation. There is no
 * CSS-only way to read localStorage.
 *
 * It sets `data-theme` on <html>, which is what the token overrides in
 * globals.css key off. `colorScheme` is set alongside so the browser renders
 * scrollbars, form controls and the address bar to match — those are chrome we
 * do not style, and a light scrollbar on a dark page is the giveaway that a
 * theme was bolted on.
 *
 * Default is light: that is the premium look the brand already has, and a
 * first-time visitor should see what the business designed.
 */
export default function ThemeScript() {
  const script = `(function(){try{
var s=localStorage.getItem('roavion-theme');
var t=(s==='dark'||s==='light')?s:'light';
document.documentElement.setAttribute('data-theme',t);
document.documentElement.style.colorScheme=t;
}catch(e){
document.documentElement.setAttribute('data-theme','light');
}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
