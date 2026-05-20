import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { User } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, KeyRound, Trash2, LogOut } from "lucide-react";

interface AccountMenuProps {
  user?: User;
  onSettingsClick?: () => void;
}

export default function AccountMenu({ user, onSettingsClick }: AccountMenuProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);

  // Change password form state
  const [cpCurrent, setCpCurrent] = useState("");
  const [cpNew, setCpNew] = useState("");
  const [cpConfirm, setCpConfirm] = useState("");
  const [cpLoading, setCpLoading] = useState(false);
  const [daPassword, setDaPassword] = useState("");
  const [daDeleteCalendarData, setDaDeleteCalendarData] = useState(false);
  const [daLoading, setDaLoading] = useState(false);

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {
      // Clear local state regardless of server response
    }
    // Set user to null first so the Router immediately shows AuthPage,
    // then clear the rest of the cache so stale data doesn't bleed into
    // the next session.
    queryClient.setQueryData(["/api/auth/me"], null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "/api/auth/me" });
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cpNew !== cpConfirm) {
      toast({ title: "Passwords don't match", description: "New password and confirmation must be identical.", variant: "destructive" });
      return;
    }
    if (cpNew.length < 8) {
      toast({ title: "Password too short", description: "New password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    setCpLoading(true);
    try {
      await apiRequest("PATCH", "/api/auth/password", { currentPassword: cpCurrent, newPassword: cpNew });
      toast({ title: "Password updated", description: "Your password has been changed successfully." });
      setCpCurrent(""); setCpNew(""); setCpConfirm("");
      setShowChangePassword(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update password";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setCpLoading(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!daPassword) {
      toast({ title: "Password required", description: "Enter your password to confirm account deletion.", variant: "destructive" });
      return;
    }

    setDaLoading(true);
    try {
      await apiRequest("DELETE", "/api/auth/account", {
        password: daPassword,
        deleteCalendarData: daDeleteCalendarData,
      });
      toast({ title: "Account deleted", description: "Your account and data have been removed." });
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "/api/auth/me" });
      setShowDeleteAccount(false);
      setDaPassword("");
      setDaDeleteCalendarData(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete account";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setDaLoading(false);
    }
  };

  const name = typeof user?.name === "string" ? user.name.trim() : "";
  const email = typeof user?.email === "string" ? user.email.trim() : "";
  const displayName = name || email || "User";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "U";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 rounded-full bg-primary/10 text-primary font-semibold hover:bg-primary/20 p-0"
            title={displayName}
          >
            {initials}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-0.5">
              <p className="text-sm font-medium leading-none truncate">{displayName}</p>
              {name && email && (
                <p className="text-xs leading-none text-muted-foreground truncate">{email}</p>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {onSettingsClick && (
            <DropdownMenuItem onClick={onSettingsClick}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setShowChangePassword(true)}>
            <KeyRound className="mr-2 h-4 w-4" />
            Change Password
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setShowDeleteAccount(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Account
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Change Password dialog */}
      <Dialog open={showChangePassword} onOpenChange={(open) => {
        if (!open) { setCpCurrent(""); setCpNew(""); setCpConfirm(""); }
        setShowChangePassword(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Update your account password. You'll need to enter your current password to confirm.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleChangePassword}>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label htmlFor="cp-current">Current password</Label>
                <Input
                  id="cp-current"
                  type="password"
                  placeholder="••••••••"
                  value={cpCurrent}
                  onChange={(e) => setCpCurrent(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cp-new">New password</Label>
                <Input
                  id="cp-new"
                  type="password"
                  placeholder="••••••••"
                  value={cpNew}
                  onChange={(e) => setCpNew(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cp-confirm">Confirm new password</Label>
                <Input
                  id="cp-confirm"
                  type="password"
                  placeholder="••••••••"
                  value={cpConfirm}
                  onChange={(e) => setCpConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowChangePassword(false)} disabled={cpLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={cpLoading || !cpCurrent || !cpNew || !cpConfirm}>
                {cpLoading ? "Updating…" : "Update Password"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteAccount} onOpenChange={(open) => {
        if (!open) {
          setDaPassword("");
          setDaDeleteCalendarData(false);
        }
        setShowDeleteAccount(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              Permanently delete your account and all associated data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDeleteAccount}>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label htmlFor="da-password">Enter your password to confirm</Label>
                <Input
                  id="da-password"
                  type="password"
                  placeholder="••••••••"
                  value={daPassword}
                  onChange={(e) => setDaPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={daDeleteCalendarData}
                  onChange={(e) => setDaDeleteCalendarData(e.target.checked)}
                />
                Also delete synced Google Calendar data (best effort)
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowDeleteAccount(false)} disabled={daLoading}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={daLoading || !daPassword}>
                {daLoading ? "Deleting..." : "Delete Account"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
