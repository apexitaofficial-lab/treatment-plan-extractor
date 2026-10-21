import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LogoutIcon } from "@/components/icons";
import Workspace from "@/components/workspace";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { logout } from "./actions";

export default async function HomePage() {
  // The proxy already guards this route; checking again here keeps the page safe on its own.
  if (!(await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value))) {
    redirect("/login");
  }

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <div className="band">
        <header className="topbar">
          <span className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/apexita-logo-light.png" alt="Apexita" width={960} height={352} className="brand-logo" />
            <span className="brand-divider" aria-hidden="true" />
            <span className="brand-title">Treatment Plan Extractor</span>
          </span>
          <form action={logout}>
            <button type="submit" className="btn on-dark">
              <LogoutIcon size={16} />
              Sign out
            </button>
          </form>
        </header>
        <div className="band-intro">
          <h1>Treatment plans to spreadsheet</h1>
          <p>
            Load a Denticon treatment plan PDF, check each patient&rsquo;s procedure codes and insurance, then download
            an Excel-ready CSV.
          </p>
        </div>
      </div>
      <main id="main" className="page">
        <Workspace />
      </main>
    </>
  );
}
