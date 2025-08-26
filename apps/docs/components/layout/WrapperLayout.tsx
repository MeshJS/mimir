"use client";
import { ReactNode, useEffect, useState } from "react";
import { useAISidebar } from "@/context/AISidebarContext";
import { MobileAISearch } from "../ai/search";
import { AISearch as SearchAI } from "../ai/search";


export function WrapperLayout({ isHomeLayout, children }: { isHomeLayout: boolean, children: ReactNode }) {

  const { isAISidebarOpen, setIsAISidebarOpen } = useAISidebar();
  const [ isMobile, setIsMobile ] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [])

  const usedHeight = isHomeLayout ? "56px" : "0px"

  return (
    <div className="flex" style={{ minHeight: `calc(100vh - ${usedHeight})` }}>
      <div
        className={`flex flex-col flex-1 ${
          isAISidebarOpen ? 'max-w-3/4' : 'max-w-full'
        }`}
      >
        <div className="flex flex-col h-full w-full max-w-[1280px] px-4 mx-auto mb-16">
          {children}
        </div>
      </div>

      {isAISidebarOpen && (
        <>
        { isMobile && (
          <div className="md:hidden">
            <MobileAISearch open={isAISidebarOpen} onOpenChange={setIsAISidebarOpen} />
          </div>
        )}

        { !isMobile && (
          <div className="hidden md:flex flex-col w-1/4 sticky" style={{
              top: usedHeight,
              height: `calc(100vh - ${usedHeight})`,
            }}>
            <SearchAI open={isAISidebarOpen} onOpenChange={setIsAISidebarOpen} />
          </div>
        )}
        </>
      )}
    </div>
  );
}