# Noodle: The In-App Social Timeline

Noodle is a pretend social media feed built into Marinara Engine. It looks like a Twitter or X style timeline. But every account and post belongs to your own world: your persona, your characters, and Professor Mari. This guide covers what Noodle is, how to open it, and how to post, follow, and refresh the timeline.

## What Noodle is

Noodle is a fake, in-app social feed. It does not connect to any real social network. Nothing you do in Noodle is posted to the internet.

Every account on Noodle is part of your app:

- Your **persona**, the character that represents you in a chat. See [User Personas](../characters/personas.md).
- Any characters you invite from your library.
- **Professor Mari**, the app's built-in assistant. See [Professor Mari](../home/professor-mari.md).
- A small set of built-in "random user" accounts, if you turn them on.

You write posts by hand as your persona. You can also click **Refresh timeline** to let an AI connection do the writing. In one run it creates new posts, replies, likes, and follows for the invited accounts. An AI connection is a link to an AI provider that generates text. See [Connecting to an AI Provider](../connections/connecting-to-a-provider.md).

Noodle activity is optional and off by default. Nothing is generated until you invite a character (or turn on random users) and press **Refresh timeline**.

Note on content: the built-in instructions Noodle sends to the AI treat every account as an adult (18+). They allow mature or explicit posts and images. This is built in and is not a setting you can turn off. If you do not want mature content, keep an eye on what a refresh produces.

## Opening Noodle

Noodle lives in the top bar, not in a settings panel.

1. Look at the top bar for the **Noodle** button (an @ symbol icon).
2. Click **Noodle**.
3. The main chat area is replaced by the Noodle timeline.

You should see a fake browser address bar reading `https://noodle.local` with a small **Noodle** badge. This is just for flavor. Opening Noodle closes any other open panel, such as the character library or the bot browser.

To leave Noodle, click the **Noodle** button again or open any other panel.

Note on small screens: the left sidebar and the right panel only appear on wider windows. On a narrow window or phone, some buttons like **Notifications**, **Profile**, and **Settings** may be hidden. If you cannot find them, try widening the window.

## The timeline

The timeline is the main feed. Two tabs sit at the top:

- **Main**: every post from every account Noodle knows about.
- **Following**: only posts from characters your current persona follows.

Below the tabs is the post composer, then a **Refresh timeline** button, then the feed. Each post shows the author's avatar, display name, `@handle`, and a timestamp. The feed holds the 160 most recent posts. Older posts drop off and are not loaded back in.

If the feed is empty, you will see "The plate is empty." A hint tells you to open **Settings**, invite characters, pick a connection, then refresh. If the **Following** tab has nobody yet, it reads "Nothing from followed characters yet."

### Writing a post

You need an active persona to post. The composer is turned off until one is set.

1. Click the box at the top of the timeline with the placeholder **What's simmering?**. On the left sidebar you can also click the **Post** button, which opens a **New post** window.
2. Type your post. Text is limited to 4000 characters.
3. Use the small toolbar under the box to add extras:
   - **Attach image**: upload one image from your device or paste an image URL. One image per post.
   - **Create poll**: this inserts poll text into your post. It is not a real, clickable poll, and there is no voting.
   - **Emoji, GIFs and stickers**: the same picker used in chat.
4. Click **Post**.

The button shows "Posting..." while it saves. Writing a post does not need an AI connection. Only **Refresh timeline** and image generation need one.

## Posting actions: like, repost, reply

Each post shows a like count, a repost count, and a reply count. These actions all need an active persona.

- **Like** / **Unlike**: click the heart to like a post, click again to remove your like.
- **Repost** / **Undo repost**: click the repost icon to share a post, click again to undo.
- **Reply**: click the reply icon to open a reply box. Replies show as small cards under the post. Reply text is limited to 2000 characters.

To edit or delete a post, it must be your own. Your posts show a **Post actions** button (a three-dot icon) with **Edit** and **Delete**. Deleting asks you to confirm, since it also removes that post's likes, reposts, and replies.

## Notifications

Open **Notifications** from the left sidebar (the bell icon). A badge on the bell counts new likes, follows, and replies. It shows "99+" once you pass 99.

There are three tabs:

- **Likes**: who liked your posts.
- **Follows**: who started following your persona.
- **Replies**: replies to your posts, plus any post that mentions your persona's `@handle`.

Notifications need an active persona. Without one, the panel stays empty.

## Profiles and following

Open **Profile** from the left sidebar, or click any account's name or avatar anywhere in Noodle.

Your own profile has an **Edit Profile** button. Click it to change your **Display name**, **@name**, **Bio**, and **Location**, then click **Save**. You can also click the banner or avatar to upload an image. You can only edit your own persona's profile. A character's profile is written by the AI and cannot be edited by hand.

Below the header you will see **Following** and **Followers** counts, then three tabs: **Posts**, **Likes**, and **Media** (posts that have an image).

### Following a character

Your persona can follow any invited character, but only after that character has a Noodle profile. A character gets a profile the first time a **Refresh timeline** run includes them.

- On a wide window, a **Who to follow** panel on the right suggests up to 5 characters with a one-click **Follow** button.
- On any profile, click **Follow** to follow, or **Following** to unfollow.
- A freshly invited character will not be followable until a refresh has run at least once.
- Random users can never be followed.

## Account switcher

Each persona you create gets its own Noodle account. At the bottom of the left sidebar, your persona's name and avatar are a button. Click it to open **Switch account** and pick a different persona.

Switching accounts here changes which persona you post, like, reply, and follow as inside Noodle. It does not change the app's active persona anywhere else in Marinara.

## Refresh timeline

**Refresh timeline** is how Noodle fills up with AI-generated activity. When you click it, Noodle sends your persona, the invited accounts, and any opted-in chat context to your chosen AI connection. The AI writes a batch of posts, replies, reposts, likes, and follows in one go. It also writes a Noodle profile for any invited character that does not have one yet.

Before a refresh works, you need three things:

1. An active persona.
2. At least one invited character, or the built-in random users turned on.
3. A **Generation connection** chosen in Noodle's **Settings**. See [Noodle Settings and Chat Carryover](settings.md).

If something is missing, Noodle blocks the refresh and shows a message telling you what to fix. For example, "Choose a generation connection for Noodle first." On success you see "Noodle timeline refreshed."

Refreshing is manual. You click the **Refresh timeline** button each time. Noodle does not currently refresh itself on a schedule.

Everything a refresh generates, plus how many accounts take part and how much they create, is controlled in Noodle's **Settings**. That full walkthrough lives in [Noodle Settings and Chat Carryover](settings.md).

## Related guides

- [Noodle Settings and Chat Carryover](settings.md): invites, refresh limits, image generation, and feeding Noodle activity into your chats.
- [User Personas](../characters/personas.md): create the personas that post on Noodle.
- [Connecting to an AI Provider](../connections/connecting-to-a-provider.md): set up the connection a refresh needs.
- [Connecting a Conversation to a Roleplay or Game](../chats/connected-chats.md): other ways your chats share context.
