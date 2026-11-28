'use strict';

const PLAINAPP_SECTION = {
    id: 'plainapp',
    label: 'MindConnect Desk Control',
    icon: 'smartphone',
    pages: [
        // Control Hub
        { page: 'plainapp-home', section: 'plainapp', group: 'Control Hub', href: '/plainapp', label: 'Control Hub', icon: 'smartphone', core: true, keywords: 'plainapp android hub overview mobile phone' },
        { page: 'plainapp-search', section: 'plainapp', group: 'Control Hub', href: '/plainapp/search', label: 'Global Search', icon: 'search', core: true, keywords: 'search notes messages contacts files apps' },

        // Files & Storage
        { page: 'plainapp-files', section: 'plainapp', group: 'Files & Storage', href: '/plainapp/files', label: 'Files Explorer', icon: 'folder_open', core: true, keywords: 'files browse filesystem storage transfer sdcard' },
        { page: 'plainapp-recent', section: 'plainapp', group: 'Files & Storage', href: '/plainapp/files/recent', label: 'Recent Files', icon: 'schedule', keywords: 'recent files downloads uploads' },
        { page: 'plainapp-trash', section: 'plainapp', group: 'Files & Storage', href: '/plainapp/trash', label: 'Trash Bin', icon: 'delete', keywords: 'trash recycle restore deleted files' },
        { page: 'plainapp-appfiles', section: 'plainapp', group: 'Files & Storage', href: '/plainapp/files/apps', label: 'App Files', icon: 'apps', keywords: 'application data obb cache files' },
        { page: 'plainapp-downloads', section: 'plainapp', group: 'Files & Storage', href: '/plainapp/downloads', label: 'Downloads', icon: 'file_download', keywords: 'downloads incoming manager' },
        { page: 'plainapp-shares', section: 'plainapp', group: 'Files & Storage', href: '/plainapp/shares', label: 'Shares', icon: 'share', keywords: 'public share links private download' },
        { page: 'plainapp-favorites', section: 'plainapp', group: 'Files & Storage', href: '/plainapp/favorites', label: 'Favorites', icon: 'star', keywords: 'favorite aliases bookmarks folders' },

        // Media & Creative
        { page: 'plainapp-images', section: 'plainapp', group: 'Media & Creative', href: '/plainapp/images', label: 'Photos & Images', icon: 'photo_library', core: true, keywords: 'photos gallery images pictures exif' },
        { page: 'plainapp-videos', section: 'plainapp', group: 'Media & Creative', href: '/plainapp/videos', label: 'Videos', icon: 'movie', core: true, keywords: 'videos movies mp4 stream player' },
        { page: 'plainapp-audios', section: 'plainapp', group: 'Media & Creative', href: '/plainapp/audios', label: 'Audio & Music', icon: 'library_music', core: true, keywords: 'music songs mp3 playlists audio player' },
        { page: 'plainapp-docs', section: 'plainapp', group: 'Media & Creative', href: '/plainapp/docs', label: 'Documents', icon: 'description', keywords: 'pdf word docs documents text reader' },
        { page: 'plainapp-image-editor', section: 'plainapp', group: 'Media & Creative', href: '/plainapp/image-editor', label: 'Image Editor', icon: 'edit', keywords: 'crop annotate filter image editor pixi' },
        { page: 'plainapp-dlna', section: 'plainapp', group: 'Media & Creative', href: '/plainapp/dlna', label: 'DLNA TV Cast', icon: 'cast', keywords: 'dlna cast tv screen stream chromecast' },

        // Communications
        { page: 'plainapp-messages', section: 'plainapp', group: 'Communications', href: '/plainapp/messages', label: 'Messages (SMS)', icon: 'sms', core: true, keywords: 'sms messages text threads conversations' },
        { page: 'plainapp-calls', section: 'plainapp', group: 'Communications', href: '/plainapp/calls', label: 'Calls & Dialer', icon: 'call', core: true, keywords: 'call logs history dial dialer phone' },
        { page: 'plainapp-contacts', section: 'plainapp', group: 'Communications', href: '/plainapp/contacts', label: 'Contacts', icon: 'contacts', core: true, keywords: 'address book phonebook contacts vcard' },
        { page: 'plainapp-chat', section: 'plainapp', group: 'Communications', href: '/plainapp/chat', label: 'Device Chat & Channels', icon: 'forum', keywords: 'chat e2ee p2p channels instant message' },
        { page: 'plainapp-notifications', section: 'plainapp', group: 'Communications', href: '/plainapp/notifications', label: 'Notifications Stream', icon: 'notifications_active', keywords: 'push alerts live notifications phone' },

        // Productivity & Tools
        { page: 'plainapp-notes', section: 'plainapp', group: 'Productivity & Tools', href: '/plainapp/notes', label: 'Markdown Notes', icon: 'sticky_note_2', core: true, keywords: 'notes markdown codemirror memo write' },
        { page: 'plainapp-feeds', section: 'plainapp', group: 'Productivity & Tools', href: '/plainapp/feeds', label: 'RSS Feeds', icon: 'rss_feed', keywords: 'rss atom feeds articles reader' },
        { page: 'plainapp-clipboard', section: 'plainapp', group: 'Productivity & Tools', href: '/plainapp/clipboard', label: 'Clipboard Sync', icon: 'content_paste', keywords: 'clipboard copy paste sync history' },
        { page: 'plainapp-screen-mirror', section: 'plainapp', group: 'Productivity & Tools', href: '/plainapp/screen-mirror', label: 'Screen Mirror', icon: 'screen_share', core: true, keywords: 'screen mirror live display remote control touch' },
        { page: 'plainapp-pomodoro', section: 'plainapp', group: 'Productivity & Tools', href: '/plainapp/pomodoro', label: 'Pomodoro Timer', icon: 'timer', keywords: 'pomodoro focus timer interval clock' },
        { page: 'plainapp-sound-meter', section: 'plainapp', group: 'Productivity & Tools', href: '/plainapp/sound-meter', label: 'Sound Meter', icon: 'graphic_eq', keywords: 'sound noise decibel db ambient mic meter' },
        { page: 'plainapp-qr-history', section: 'plainapp', group: 'Productivity & Tools', href: '/plainapp/qr-history', label: 'QR Scanner History', icon: 'qr_code_scanner', keywords: 'qr barcode scanner history logs' },
        { page: 'plainapp-exchange-rate', section: 'plainapp', group: 'Productivity & Tools', href: '/plainapp/exchange-rate', label: 'Exchange Rates', icon: 'currency_exchange', keywords: 'currency exchange rates forex money' },

        // Device & Network
        { page: 'plainapp-apps', section: 'plainapp', group: 'Device & Network', href: '/plainapp/apps', label: 'Apps & Packages', icon: 'apps', core: true, keywords: 'installed apps apk download packages android' },
        { page: 'plainapp-nearby', section: 'plainapp', group: 'Device & Network', href: '/plainapp/nearby', label: 'Nearby Discovery', icon: 'radar', keywords: 'mdns ble wifi aware local network discovery' },
        { page: 'plainapp-tags', section: 'plainapp', group: 'Device & Network', href: '/plainapp/tags', label: 'Tags & Key-Value', icon: 'label', keywords: 'tags labels metadata key value kv store' },
        { page: 'plainapp-access-control', section: 'plainapp', group: 'Device & Network', href: '/plainapp/access-control', label: 'Web Access Control', icon: 'security', keywords: 'security permissions 14 toggles granular access' },
        { page: 'plainapp-sessions', section: 'plainapp', group: 'Device & Network', href: '/plainapp/sessions', label: 'Active Sessions', icon: 'devices_fold', keywords: 'sessions web browsers revoke rename tokens' },
        { page: 'plainapp-device-info', section: 'plainapp', group: 'Device & Network', href: '/plainapp/device-info', label: 'Device Info & Hardware', icon: 'info', keywords: 'specs cpu ram battery storage hardware build' },
        { page: 'plainapp-logs', section: 'plainapp', group: 'Device & Network', href: '/plainapp/logs', label: 'Events & System Logs', icon: 'receipt_long', keywords: 'audit logs logcat crash events errors' },
        { page: 'plainapp-prefs', section: 'plainapp', group: 'Device & Network', href: '/plainapp/prefs', label: 'Preferences & Database', icon: 'tune', keywords: 'settings prefs sqlite developer db export backup' },
    ],
};

const PLAINAPP_PANEL_ENTRY = {
    key: 'plainapp',
    label: 'MindConnect Desk Control',
    group: 'operations',
    readPermission: 'device.view',
    writePermission: 'device.edit',
};

module.exports = {
    PLAINAPP_SECTION,
    PLAINAPP_PANEL_ENTRY,
};
