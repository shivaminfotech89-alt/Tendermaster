import { AlertTriangle } from "lucide-react";

interface Props {
  isOpen: boolean;
  title: string;
  message: string;
  /** Label for the safe action (stays on page). Default: "Stay on Page" */
  stayLabel?: string;
  /** Label for the destructive action (navigates away). Default: "Leave" */
  leaveLabel?: string;
  /** Fired when user chooses to stay */
  onStay: () => void;
  /** Fired when user confirms leaving */
  onLeave: () => void;
}

export function UnsavedChangesModal({
  isOpen,
  title,
  message,
  stayLabel = "Stay on Page",
  leaveLabel = "Leave",
  onStay,
  onLeave,
}: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-600 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onLeave}
            className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
          >
            {leaveLabel}
          </button>
          <button
            onClick={onStay}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            {stayLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
