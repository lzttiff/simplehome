import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PropertyTemplate } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Home, Building } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PROPERTY_TYPES = [
  { type: "single_family", label: "Single-Family Home", icon: Home },
  { type: "condo", label: "Condo", icon: Building },
];

interface AddPropertyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (template: PropertyTemplate) => void;
}

export default function AddPropertyModal({ isOpen, onClose, onSuccess }: AddPropertyModalProps) {
  const { toast } = useToast();
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/properties", {
        type: selectedType,
        name: customName.trim() || undefined,
      });
      return res.json() as Promise<PropertyTemplate>;
    },
    onSuccess: (template) => {
      onSuccess(template);
      setSelectedType(null);
      setCustomName("");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add property",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    if (mutation.isPending) return;
    setSelectedType(null);
    setCustomName("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a Property</DialogTitle>
          <DialogDescription>
            Choose the type for your new property. You can manage up to 5 properties.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            {PROPERTY_TYPES.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={cn(
                  "border-2 rounded-lg p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                  selectedType === type
                    ? "border-primary bg-primary/5"
                    : "border-gray-200 hover:border-gray-300"
                )}
              >
                <Icon className="h-6 w-6 mb-2 text-primary" />
                <p className="font-medium text-sm">{label}</p>
              </button>
            ))}
          </div>

          <div className="space-y-1">
            <Label htmlFor="property-name">Property Name (optional)</Label>
            <Input
              id="property-name"
              placeholder="e.g. 123 Main St, Beach House..."
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              maxLength={80}
              disabled={mutation.isPending}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!selectedType || mutation.isPending}
          >
            {mutation.isPending ? "Adding..." : "Add Property"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
