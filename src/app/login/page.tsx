import type { Metadata } from "next";
import LoginForm from "./login-form";

export const metadata: Metadata = { title: "Sign in · Treatment Plan Extractor" };

export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-aside">
        <span className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/apexita-logo-light.png" alt="Apexita" width={960} height={352} className="brand-logo" />
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-title">Treatment Plan Extractor</span>
        </span>
        <div className="login-pitch">
          <p className="login-pitch-title">From PDF to spreadsheet in seconds.</p>
          <ul>
            <li>Reads Denticon treatment plans of any length</li>
            <li>Finds patient names, procedure codes and insurance</li>
            <li>Files stay on this computer — nothing is uploaded</li>
          </ul>
        </div>
      </section>
      <section className="login-main">
        <div className="login-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/apexita-logo-dark.png" alt="Apexita" width={960} height={352} className="login-logo" />
          <h1>Sign in</h1>
          <p className="muted">Use the username and password provided by your administrator.</p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
