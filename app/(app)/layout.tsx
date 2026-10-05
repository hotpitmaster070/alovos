import Sidebar from "@/components/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Sidebar />
      <main className="px-4 py-8 lg:ml-64 lg:px-10">
        <div className="mx-auto max-w-[390px] lg:max-w-4xl">{children}</div>
      </main>
    </div>
  );
}
