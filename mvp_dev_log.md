# MVP AI Development Log

This is my one-page breakdown documenting my AI-first development process.

## Tools and Workflow

For my Collab Canvas MVP I exclusively used ChatGPT 5 in the web interface.
No integration necessary, just a conversation with the AI.

## Prompting Strategies

I started by converting the project requirements to markdown, and then I
envisioned a series of apps that I wanted each one building on the last. First,
the minimal authentication app, that merely lets users log in an out, then the
minimal "Presence App," that displayed which users are online and offline, and
finally richer and more feature complete versions of a the canvas app, first a
version that broadcasts the scroll offset and cursor offset to the presence
list, then adding shape creation/deletion, and finally the multiplayer cursors
as the icing on top.

One strategy that I used was I had ChatGPT5 write a python script to print the
contents of all the code files in my project along with their paths so that I
could quickly get a new instance of ChatGPT5 up to speed on my project.

## Code Analysis

More than 99% of the code was AI-generated. I merely played the orchestration
role, connecting apps, directing progress, and testing.

## Strengths and Limitations

I found that getting the minimal viable authentication app enabling Github and
email magic link was especially finicky. After many promptings it started
working and I was afraid to touch that code again for fear of breaking it.
Later on in the process, the LLM suggested changes to make the authentication
"more robust" and that completely bricked the authentication and I had to
revert the changes.

I also had a big issue with broadcasting the cursor position and getting the dot
grid to show up that took hours of prompting to resolve. I honestly wished I had
more exposure to React so I could surgically fix the issue but with
perseverance I eventually got the LLM to fix the issue.

I also found that as the context window filled for the ChatGPT5 instance the
website got slow and unwieldy, two times I had to start a new chat to clear
out all the context. ChatGPT5 would often get unstuck with debugging a problem
if it "sees it with fresh eyes." That is, I would start a new instance, provide
it the project requirements, all my code so far, and directives regarding the
last thing I was trying to accomplish and the new instance would often spot the
mistake of the old instance.

I really was surprised that ChatGPT5 couldn't one-shot authentication, I
expected something like that would be well represented in its corpus, but alas.
