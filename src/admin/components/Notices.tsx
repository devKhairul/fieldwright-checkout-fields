import { Notice } from '@wordpress/components';

/** A button offered inside a notice. */
export interface NoticeAction {
	label: string;
	onClick: () => void;
	variant?: 'primary' | 'secondary' | 'link';
}

export interface AppNotice {
	id: string;
	status: 'error' | 'warning' | 'info' | 'success';
	message: string;
	isDismissible?: boolean;
	/** Something the merchant can do about it, offered inside the notice. */
	actions?: NoticeAction[];
}

interface NoticesProps {
	notices: AppNotice[];
	onRemove: ( id: string ) => void;
}

export default function Notices( { notices, onRemove }: NoticesProps ) {
	if ( 0 === notices.length ) {
		return null;
	}

	return (
		<div className="cbwb-notices">
			{ notices.map( ( notice ) => (
				<Notice
					key={ notice.id }
					status={ notice.status }
					isDismissible={ notice.isDismissible ?? true }
					actions={ notice.actions ?? [] }
					onRemove={ () => onRemove( notice.id ) }
				>
					{ notice.message }
				</Notice>
			) ) }
		</div>
	);
}
