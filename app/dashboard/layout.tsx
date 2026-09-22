import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import NavLinks from "./NavLinks";
import SignOutButton from "./SignOutButton";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const user = await getSessionUser();
  if (!user) redirect("/");

  const fullName = [user.firstName, user.middleName, user.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">
          <Link href="/dashboard">Eccelesia</Link>
        </div>
        <NavLinks />
        <div className="dashboard-sidebar-footer">
          <div className="dashboard-user">
            <span className="dashboard-user-name">{fullName}</span>
            <span className="dashboard-user-email">{user.email}</span>
          </div>
          <SignOutButton />
        </div>
      </aside>
      <main className="dashboard-main">{children}</main>
    </div>
  );
}