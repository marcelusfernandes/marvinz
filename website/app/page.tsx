import "./v2.css";
import { TopBar } from "@/components/TopBar";
import { Footer } from "@/components/Footer";
import { RevealController } from "@/components/RevealController";
import { Ticker } from "@/components/v2/Ticker";
import { HeroV2 } from "@/components/v2/HeroV2";
import { ServiceCards } from "@/components/v2/ServiceCards";
import { SheetSection } from "@/components/v2/SheetSection";
import { SheetHeading } from "@/components/v2/SheetHeading";
import { StepsRow } from "@/components/v2/StepsRow";
import { BentoGrid } from "@/components/v2/BentoGrid";
import { MockupSpreadV2 } from "@/components/v2/MockupSpreadV2";
import { V2ThemeDefault } from "@/components/v2/V2ThemeDefault";

export default function Home() {
  return (
    <div className="v2Root">
      <V2ThemeDefault />
      {/* cutthecode page structure: v2Root is the contrasting frame (bg + padding).
          Ticker sits on the page bg; v2Surface is the rounded content card below
          it (no overflow clip — sticky nav keeps working). */}
      <Ticker />
      <div className="v2Surface">
        <TopBar solid hideToggle />
        <main id="top">
          <HeroV2 />
          <ServiceCards />

          <SheetSection id="how-it-works" tone="1" ariaLabel="How it works">
            <SheetHeading
              eyebrow="01 · How it works"
              title="One product, not two."
              titleId="v2-how-title"
              lead="Marvinz makes the DIY stack of “Claude Code CLI + Obsidian” one product. The agent edits your local markdown directly inside a workspace where you read, navigate and curate — every change snapshotted, every tool call approvable."
            />
            <StepsRow />
          </SheetSection>

          <SheetSection id="features" tone="2" ariaLabel="Features">
            <SheetHeading
              eyebrow="02 · Features"
              title="The workspace native to the Claude Code + vault workflow."
              titleId="v2-features-title"
              lead="Built for engineers and PMs who already run Claude Code alongside a markdown vault and want to read, navigate and validate what the AI generates — to trust it and build on it, instead of losing it in a terminal scroll."
            />
            <BentoGrid />
          </SheetSection>

        <MockupSpreadV2 />
        </main>
        <Footer />
      </div>
      <RevealController />
    </div>
  );
}
