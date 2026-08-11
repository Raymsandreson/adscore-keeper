import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Link2 } from 'lucide-react';
import { Contact } from '@/hooks/useContacts';
import { ContactRelationshipsPanel } from './ContactRelationshipsPanel';

interface ContactRelationshipsManagerProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ContactRelationshipsManager: React.FC<ContactRelationshipsManagerProps> = ({
  contact,
  open,
  onOpenChange,
}) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            Vínculos de {contact?.full_name}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-hidden flex flex-col mt-4">
          <ContactRelationshipsPanel contact={contact} />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ContactRelationshipsManager;
