document.addEventListener('DOMContentLoaded', () => {
    const recyclingForm = document.getElementById('recyclingForm');
    const itemsContainer = document.getElementById('itemsContainer');

    // تحميل المشاركات المحفوظة سابقاً
    loadPosts();

    if (recyclingForm) {
        recyclingForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const title = document.getElementById('title').value;
            const category = document.getElementById('category').value;
            const material = document.getElementById('material').value;
            const description = document.getElementById('description').value;

            const newPost = { title, category, material, description };

            savePost(newPost);
            renderPost(newPost);

            alert(`تم نشر "${title}" بنجاح!`);
            recyclingForm.reset();
        });
    }

    function savePost(post) {
        let posts = JSON.parse(localStorage.getItem('biaty_posts')) || [];
        posts.unshift(post);
        localStorage.setItem('biaty_posts', JSON.stringify(posts));
    }

    function loadPosts() {
        if (!itemsContainer) return;
        const posts = JSON.parse(localStorage.getItem('biaty_posts')) || [];
        
        if (posts.length > 0) {
            const loadingText = itemsContainer.querySelector('.loading-text');
            if (loadingText) loadingText.remove();
            posts.slice().reverse().forEach(post => renderPost(post));
        }
    }

    function renderPost(post) {
        if (!itemsContainer) return;
        const loadingText = itemsContainer.querySelector('.loading-text');
        if (loadingText) loadingText.remove();

        const card = document.createElement('div');
        card.className = 'item-card';
        card.dataset.category = post.category;

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
        description.style.marginTop = '0.5rem';
        description.textContent = post.description;

        card.append(tag, title, material, description);
        itemsContainer.prepend(card);
    }
});
