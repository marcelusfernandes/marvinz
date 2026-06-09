import { TopBar } from "@/components/TopBar";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Features } from "@/components/Features";
import { ScreenshotSpread } from "@/components/ScreenshotSpread";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <TopBar />
      <main id="top">
        <Hero />
        <HowItWorks />
        <Features />
        <ScreenshotSpread />
      </main>
      <Footer />
    </>
  );
}
