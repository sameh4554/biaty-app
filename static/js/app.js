document.addEventListener('DOMContentLoaded', () => {
    const recyclingForm = document.getElementById('recyclingForm');
    const itemsContainer = document.getElementById('itemsContainer');

    loadPosts();

    if (recyclingForm) {
        recyclingForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const submitButton = recyclingForm.querySelector('[type="submit"]');
            const post = {
                author: document.getElementById('author').value.trim(),
                title: document.getElementById('title').value.trim(),
                category: document.getElementById('category').value,
                material: document.getElementById('material').value.trim(),
                description: document.getElementById('description').value.trim()
            };

            submitButton.disabled = true;
            try {
                const response = await fetch('/api/posts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(post)
                });
                const savedPost = await response.json();
                if (!response.ok) throw new Error(savedPost.error || 'تعذر نشر المنشور.');

                renderPost(savedPost, true);
                recyclingForm.reset();
                alert(`تم نشر "${savedPost.title}" بنجاح!`);
            } catch (error) {
                alert(error.message || 'تعذر الاتصال بالخادم. حاول مرة أخرى.');
            } finally {
                submitButton.disabled = false;
            }
        });
    }

    async function loadPosts() {
        if (!itemsContainer) return;
        try {
            const response = await fetch('/api/posts');
            if (!response.ok) throw new Error('تعذر تحميل المنشورات.');
            const posts = await response.json();
            itemsContainer.replaceChildren();
            if (posts.length === 0) {
                itemsContainer.innerHTML = '<p class="loading-text">لا توجد منشورات بعد.</p>';
                return;
            }
            posts.forEach((post) => renderPost(post));
        } catch (error) {
            const loadingText = itemsContainer.querySelector('.loading-text');
            if (loadingText) loadingText.textContent = error.message || 'تعذر تحميل المنشورات.';
        }
    }

    function renderPost(post, prepend = false) {
        if (!itemsContainer) return;
        const loadingText = itemsContainer.querySelector('.loading-text');
        if (loadingText) loadingText.remove();

        const card = document.createElement('article');
        card.className = 'item-card';
        card.dataset.category = post.category;
        card.dataset.postId = post.id;

        const authorRow = document.createElement('div');
        authorRow.className = 'post-author';
        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        avatar.textContent = (post.author || 'عضو').trim().charAt(0);
        const authorDetails = document.createElement('div');
        const authorName = document.createElement('strong');
        authorName.textContent = post.author || 'عضو في بيئتي';
        const authorMeta = document.createElement('small');
        authorMeta.textContent = 'من المجتمع';
        if (post.author_id) {
            const profileLink = document.createElement('a');
            profileLink.className = 'post-profile-link';
            profileLink.href = `/users/${post.author_id}`;
            profileLink.append(authorName, authorMeta);
            authorRow.append(avatar, profileLink);
        } else {
            authorDetails.append(authorName, authorMeta);
            authorRow.append(avatar, authorDetails);
        }

        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = post.category;

        const title = document.createElement('h3');
        title.textContent = post.title;

        const material = document.createElement('p');
        const materialLabel = document.createElement('strong');
        materialLabel.textContent = 'المادة: ';
        material.append(materialLabel, document.createTextNode(post.material));

        const description = document.createElement('p');
        description.className = 'post-description';
        description.textContent = post.description;

        card.append(authorRow, tag, title, material, description);
        addCommentsPanel(card, Number(post.comments_count) || 0);
        if (prepend) itemsContainer.prepend(card);
        else itemsContainer.append(card);
    }

    function addCommentsPanel(card, initialCount) {
        const panel = document.createElement('details');
        panel.className = 'comments-panel';
        const summary = document.createElement('summary');
        const comments = document.createElement('div');
        comments.className = 'comment-list';
        const status = document.createElement('p');
        status.className = 'comment-status';
        status.setAttribute('role', 'status');
        const form = document.createElement('form');
        form.className = 'comment-form';

        const name = document.createElement('input');
        name.type = 'text';
        name.name = 'author';
        name.placeholder = 'اسمك';
        name.maxLength = 80;
        name.required = true;
        name.setAttribute('aria-label', 'اسم صاحب التعليق');

        const body = document.createElement('textarea');
        body.name = 'body';
        body.placeholder = 'اكتب تعليقاً مفيداً...';
        body.maxLength = 1000;
        body.rows = 2;
        body.required = true;
        body.setAttribute('aria-label', 'نص التعليق');

        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'أضف تعليقاً';
        form.append(name, body, submit);
        panel.append(summary, comments, status, form);
        card.append(panel);

        let loadedComments;
        const updateCount = (count) => {
            summary.textContent = `التعليقات (${count}) · شارك برأيك`;
        };
        updateCount(initialCount);

        const loadComments = () => {
            if (!loadedComments) {
                loadedComments = fetch(`/api/posts/${card.dataset.postId}/comments`)
                    .then(async (response) => {
                        if (!response.ok) throw new Error('تعذر تحميل التعليقات.');
                        const savedComments = await response.json();
                        savedComments.forEach((comment) => renderComment(comments, comment));
                        updateCount(savedComments.length);
                    })
                    .catch((error) => {
                        status.textContent = error.message;
                        loadedComments = null;
                    });
            }
            return loadedComments;
        };

        panel.addEventListener('toggle', () => {
            if (panel.open) loadComments();
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            await loadComments();
            submit.disabled = true;
            status.textContent = '';
            try {
                const response = await fetch(`/api/posts/${card.dataset.postId}/comments`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ author: name.value.trim(), body: body.value.trim() })
                });
                const savedComment = await response.json();
                if (!response.ok) throw new Error(savedComment.error || 'تعذر نشر التعليق.');
                renderComment(comments, savedComment);
                updateCount(comments.childElementCount);
                body.value = '';
            } catch (error) {
                status.textContent = error.message || 'تعذر الاتصال بالخادم. حاول مرة أخرى.';
            } finally {
                submit.disabled = false;
            }
        });
    }

    function renderComment(container, comment) {
        const item = document.createElement('article');
        item.className = 'comment-item';
        const author = document.createElement('strong');
        author.textContent = comment.author;
        const body = document.createElement('p');
        body.textContent = comment.body;
        item.append(author, body);
        container.append(item);
    }

    const mapElement = document.getElementById('tunisiaMap');
    if (mapElement && window.L) {
        const map = L.map(mapElement, { scrollWheelZoom: false }).setView([34.0, 9.5], 6);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap',
            maxZoom: 18
        }).addTo(map);

        const sampleReports = [
            { name: 'تونس الكبرى', coords: [36.8065, 10.1815] },
            { name: 'بنزرت', coords: [37.2744, 9.8739] },
            { name: 'نابل', coords: [36.4513, 10.7357] },
            { name: 'القيروان', coords: [35.6781, 10.0963] },
            { name: 'سوسة', coords: [35.8256, 10.6084] },
            { name: 'قفصة', coords: [34.425, 8.7842] },
            { name: 'صفاقس', coords: [34.7406, 10.7603] },
            { name: 'قابس', coords: [33.8815, 10.0982] }
        ];

        sampleReports.forEach((report) => {
            report.marker = L.circleMarker(report.coords, {
                radius: 7,
                color: '#fff',
                weight: 2,
                fillColor: '#e56c4b',
                fillOpacity: 0.95
            }).addTo(map).bindPopup(`<strong>${report.name}</strong><br>بلاغ تجريبي يحتاج إلى التثبت`);
        });

        const directions = document.getElementById('mapDirections');
        const locateButton = document.getElementById('locateNearest');
        const pickButton = document.getElementById('pickMapLocation');
        let isPickingLocation = false;
        let userMarker;

        function findNearestReport(origin) {
            const nearest = sampleReports.reduce((closest, report) => {
                const distance = distanceInKm(origin, report.coords);
                return distance < closest.distance ? { report, distance } : closest;
            }, { report: null, distance: Infinity });

            if (!nearest.report) return;
            if (userMarker) userMarker.remove();
            userMarker = L.circleMarker(origin, {
                radius: 7,
                color: '#fff',
                weight: 2,
                fillColor: '#2878a3',
                fillOpacity: 1
            }).addTo(map).bindPopup('موقعك المحدد');

            nearest.report.marker.openPopup();
            map.fitBounds(L.latLngBounds([origin, nearest.report.coords]), {
                padding: [30, 30],
                maxZoom: 9
            });

            const route = new URL('https://www.openstreetmap.org/directions');
            route.searchParams.set('engine', 'fossgis_osrm_car');
            route.searchParams.set('route', `${origin.lat},${origin.lng};${nearest.report.coords[0]},${nearest.report.coords[1]}`);
            directions.replaceChildren();
            directions.append(document.createTextNode(
                `أقرب بلاغ تجريبي: ${nearest.report.name}، على بُعد نحو ${Math.round(nearest.distance)} كم. `
            ));
            const link = document.createElement('a');
            link.href = route.toString();
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'افتح اتجاهات القيادة';
            directions.append(link);
            isPickingLocation = false;
            pickButton.setAttribute('aria-pressed', 'false');
            map.getContainer().style.cursor = '';
        }

        function distanceInKm(origin, destination) {
            const radians = (degrees) => degrees * Math.PI / 180;
            const latitudeDelta = radians(destination[0] - origin.lat);
            const longitudeDelta = radians(destination[1] - origin.lng);
            const value = Math.sin(latitudeDelta / 2) ** 2
                + Math.cos(radians(origin.lat)) * Math.cos(radians(destination[0]))
                * Math.sin(longitudeDelta / 2) ** 2;
            return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
        }

        locateButton.addEventListener('click', () => {
            if (!navigator.geolocation) {
                directions.textContent = 'المتصفح لا يدعم تحديد الموقع. اختر موقعك على الخريطة.';
                return;
            }
            directions.textContent = 'جارٍ تحديد موقعك...';
            navigator.geolocation.getCurrentPosition(
                ({ coords }) => findNearestReport({ lat: coords.latitude, lng: coords.longitude }),
                () => {
                    directions.textContent = 'تعذر تحديد موقعك. اسمح بالوصول للموقع أو اختره على الخريطة.';
                },
                { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
            );
        });

        pickButton.addEventListener('click', () => {
            isPickingLocation = !isPickingLocation;
            pickButton.setAttribute('aria-pressed', String(isPickingLocation));
            map.getContainer().style.cursor = isPickingLocation ? 'crosshair' : '';
            directions.textContent = isPickingLocation
                ? 'انقر على الخريطة لتحديد موقعك التقريبي.'
                : 'اعثر على أقرب بلاغ تجريبي، ثم افتح المسار على الخريطة.';
        });

        map.on('click', (event) => {
            if (isPickingLocation) findNearestReport(event.latlng);
        });
    }

    const assistantForm = document.getElementById('assistantForm');
    if (assistantForm) {
        assistantForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const input = document.getElementById('assistantInput');
            const question = input.value.trim();
            if (!question) return;

            const submitButton = assistantForm.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            appendMessage(question, 'user-message');
            input.value = '';
            const replyMessage = appendMessage('يفكر لبيب...', 'assistant-message');

            try {
                const response = await fetch('/api/labib-chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: question })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'تعذر الاتصال بالمساعد لبيب.');
                replyMessage.textContent = result.reply;
            } catch (error) {
                replyMessage.textContent = error.message || 'تعذر الاتصال بالمساعد لبيب. حاول مرة أخرى.';
            } finally {
                submitButton.disabled = false;
                input.focus();
            }
        });
    }

    function appendMessage(text, className) {
        const message = document.createElement('div');
        message.className = `chat-message ${className}`;
        message.textContent = text;
        document.getElementById('chatMessages').append(message);
        message.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return message;
    }

    const messageThread = document.getElementById('messageThread');
    if (messageThread) {
        const recipientId = messageThread.dataset.recipientId;
        const currentUserId = Number(messageThread.dataset.currentUserId);
        const messageList = document.getElementById('messageList');
        const messageStatus = document.getElementById('messageStatus');
        let lastMessageId = 0;
        let hasLoadedMessages = false;

        async function loadMessages() {
            try {
                const response = await fetch(`/api/conversations/${recipientId}/messages`);
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'تعذر تحميل الرسائل.');
                if (!hasLoadedMessages) {
                    messageList.replaceChildren();
                    hasLoadedMessages = true;
                }
                result.forEach((message) => {
                    if (message.id > lastMessageId) renderMessage(message);
                });
                if (result.length === 0 && messageList.childElementCount === 0) {
                    messageList.innerHTML = '<p class="empty-state">ابدأ المحادثة برسالة ترحيب.</p>';
                }
                messageStatus.textContent = '';
            } catch (error) {
                messageStatus.textContent = error.message || 'تعذر الاتصال بالخادم.';
            }
        }

        function renderMessage(message) {
            const emptyState = messageList.querySelector('.empty-state');
            if (emptyState) emptyState.remove();
            const bubble = document.createElement('article');
            bubble.className = `message-bubble${message.sender_id === currentUserId ? ' sent-message' : ' received-message'}`;
            const sender = document.createElement('strong');
            sender.textContent = message.sender_name;
            const body = document.createElement('p');
            body.textContent = message.body;
            const time = document.createElement('time');
            time.dateTime = message.created_at.replace(' ', 'T') + 'Z';
            time.textContent = new Date(time.dateTime).toLocaleTimeString('ar-TN', {
                hour: '2-digit',
                minute: '2-digit'
            });
            bubble.append(sender, body, time);
            messageList.append(bubble);
            lastMessageId = message.id;
            updateConversationPreview(message);
            bubble.scrollIntoView({ block: 'nearest' });
        }

        function updateConversationPreview(message) {
            const list = document.getElementById('conversationList');
            const emptyState = document.getElementById('noConversations');
            let link = list.querySelector(`[data-user-id="${recipientId}"]`);
            if (!link) {
                link = document.createElement('a');
                link.className = 'conversation-link active';
                link.dataset.userId = recipientId;
                link.href = `/messages/${recipientId}`;
                const avatar = document.createElement('span');
                avatar.className = 'conversation-avatar';
                avatar.textContent = document.querySelector('.thread-header h2').textContent.trim().charAt(0);
                const copy = document.createElement('span');
                copy.className = 'conversation-copy';
                const name = document.createElement('strong');
                name.textContent = document.querySelector('.thread-header h2').textContent.trim();
                const preview = document.createElement('small');
                copy.append(name, preview);
                link.append(avatar, copy);
            }
            link.querySelector('.conversation-copy small').textContent = message.body;
            list.prepend(link);
            emptyState.hidden = true;
        }

        document.getElementById('directMessageForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const textarea = document.getElementById('messageBody');
            const submitButton = event.currentTarget.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            messageStatus.textContent = '';
            try {
                const response = await fetch(`/api/conversations/${recipientId}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ body: textarea.value.trim() })
                });
                const message = await response.json();
                if (!response.ok) throw new Error(message.error || 'تعذر إرسال الرسالة.');
                if (message.id > lastMessageId) renderMessage(message);
                textarea.value = '';
            } catch (error) {
                messageStatus.textContent = error.message || 'تعذر الاتصال بالخادم.';
            } finally {
                submitButton.disabled = false;
            }
        });

        loadMessages();
        const pollTimer = window.setInterval(() => {
            if (!document.hidden) loadMessages();
        }, 4000);
        window.addEventListener('pagehide', () => window.clearInterval(pollTimer), { once: true });
    }
});
