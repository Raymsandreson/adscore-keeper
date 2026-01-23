import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";

interface WorkflowTimerProps {
  isRunning: boolean;
  startTime: Date | null;
}

export const WorkflowTimer = ({ isRunning, startTime }: WorkflowTimerProps) => {
  const [elapsed, setElapsed] = useState(0);
  
  useEffect(() => {
    if (!isRunning || !startTime) {
      return;
    }
    
    // Calculate initial elapsed time
    const initialElapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
    setElapsed(initialElapsed);
    
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = Math.floor((now - startTime.getTime()) / 1000);
      setElapsed(elapsedSeconds);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isRunning, startTime]);
  
  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  if (!startTime) return null;

  return (
    <Badge variant="outline" className="gap-1.5 font-mono text-xs tabular-nums">
      <Clock className="h-3 w-3 text-muted-foreground" />
      {formatTime(elapsed)}
    </Badge>
  );
};
